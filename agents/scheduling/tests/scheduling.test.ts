/**
 * The method as code: every rule the skill validated across real jobs is a
 * test here, against the seed config and the fixture HCP data.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seed } from "../agent/lib/config/seed";
import { fixtureSource } from "../agent/lib/hcp/source";
import { buildBacklog, treeOnlyDollars } from "../agent/lib/scheduling/backlog";
import { buildBoard } from "../agent/lib/scheduling/board";
import { validateCrew } from "../agent/lib/scheduling/crews";
import { addDays, localDate, mondayOf, weekdayOf } from "../agent/lib/scheduling/dates";
import { checkEquipment } from "../agent/lib/scheduling/equipment";
import { groundState } from "../agent/lib/scheduling/ground";
import { routeDay } from "../agent/lib/scheduling/routing";
import { sizeJob } from "../agent/lib/scheduling/sizing";
import { absencesFor, expandRecurrence, outByDay } from "../agent/lib/scheduling/time-off";

const hcp = fixtureSource(new URL("../evals/data/hcp", import.meta.url).pathname);
const TODAY = "2026-09-21";
const WEEK = "2026-09-28";
const crew = (members: string[], tags: string[] = [], out?: string[]) => validateCrew({ members, tags, ...(out ? { out } : {}) }, seed.roster, seed.crew_rules, seed.equipment);

describe("dates", () => {
  it("converts UTC to Chicago days and finds Mondays", () => {
    assert.equal(localDate("2026-09-22T03:30:00Z"), "2026-09-21"); // 10:30 pm Chicago the day before
    assert.equal(weekdayOf("2026-09-27"), "Sun");
    assert.equal(mondayOf("2026-09-24"), "2026-09-21");
    assert.equal(addDays("2026-09-30", 2), "2026-10-02");
  });
});

describe("time off (step 1A)", () => {
  it("expands COUNT and UNTIL rules into every day, not just the first", () => {
    assert.deepEqual(expandRecurrence("2026-08-19", "COUNT=6;FREQ=DAILY").dates, ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24"]);
    assert.deepEqual(expandRecurrence("2026-08-31", "FREQ=DAILY;UNTIL=20260907T050000Z").dates.length, 8);
    assert.deepEqual(expandRecurrence("2026-09-01", null).dates, ["2026-09-01"]);
    assert.ok(expandRecurrence("2026-09-01", "FREQ=MONTHLY;COUNT=3").note);
  });
  it("catches a series that STARTED before the week and runs into it", async () => {
    const events = await hcp.events();
    const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];
    const out = outByDay(absencesFor(events, days, seed.roster.people.map((p) => p.name)));
    assert.deepEqual(out["2026-09-28"], ["James", "Luke"]); // Luke's 6-day series began 9/24
    assert.deepEqual(out["2026-09-29"], ["James", "Luke"]);
    assert.deepEqual(out["2026-09-30"], ["Ethan"]); // UNTIL rule
    assert.deepEqual(out["2026-10-01"], ["Elijah", "Ethan"]); // "Nic & Eli OFF" has no assignee → title match; Nic is not on the roster
  });
  it("ignores the office/sales calendar", async () => {
    const events = await hcp.events();
    const names = absencesFor(events, ["2026-09-29"], ["Nic", "Matt"]).map((a) => a.event_name);
    assert.ok(!names.includes("Nic - Available") && !names.includes("BIDS"));
  });
  it("CLOSED takes everyone out", async () => {
    const events = await hcp.events();
    assert.deepEqual(outByDay(absencesFor(events, ["2026-11-26"], []))["2026-11-26"], ["*"]);
  });
});

describe("ground (step 1)", () => {
  it("groups a standard event and applies the tier from dry days", async () => {
    const g = groundState(await hcp.precipitation(seed.dryness.weather_point, 14, 7), TODAY, seed.dryness);
    assert.equal(g.severe, false);
    assert.deepEqual(g.last_event, { start: "2026-09-15", end: "2026-09-16", total_inches: 0.75, max_day_inches: 0.4 });
    assert.equal(g.dry_days, 5);
    assert.equal(g.tier, "dry");
    assert.ok(g.unlocked_tags.includes("Needs To Be Dry") && !g.unlocked_tags.includes("Needs To Be Very Dry"));
    assert.deepEqual(g.rain_ahead.map((d) => d.date), ["2026-09-24"]);
  });
  it("a severe event is a human call — no tier", () => {
    const daily = [{ date: "2026-09-19", inches: 0.7 }, { date: "2026-09-20", inches: 0.6 }, { date: "2026-09-21", inches: 0 }];
    const g = groundState(daily, TODAY, seed.dryness);
    assert.equal(g.severe, true);
    assert.equal(g.ask, true);
    assert.equal(g.tier, null);
  });
});

describe("sizing (step 4)", () => {
  it("uses the table and rounds up to the half hour", () => {
    assert.equal(sizeJob({ tree_only_price: 1750, crew_size: 3, tags: [] }, seed.sizing).block_hours, 2);
    assert.equal(sizeJob({ tree_only_price: 1750, crew_size: 2, tags: [] }, seed.sizing).block_hours, 3);
    assert.equal(sizeJob({ tree_only_price: 4250, crew_size: 4, tags: [] }, seed.sizing).block_hours, 4); // 5 × 0.75 = 3.75 → 4.0
  });
  it("asks above the full-day rung instead of silently under-sizing", () => {
    const r = sizeJob({ tree_only_price: 10675, crew_size: 3, tags: [] }, seed.sizing);
    assert.equal(r.full_day, true);
    assert.equal(r.ask, true);
    assert.equal(r.implied_crew_hours, 12.9);
    assert.equal(sizeJob({ tree_only_price: 5900, crew_size: 3, tags: [] }, seed.sizing).ask, false);
  });
  it("crane locks the day; PHC is a 45-minute stop; hints are surfaced", () => {
    assert.equal(sizeJob({ tree_only_price: 6800, crew_size: 3, tags: ["Treezilla"] }, seed.sizing).block_hours, 6);
    assert.equal(sizeJob({ tree_only_price: 125, crew_size: 3, tags: [], job_type: "Plant Health Care" }, seed.sizing).block_hours, 0.8);
    assert.equal(sizeJob({ tree_only_price: 1500, crew_size: 3, tags: ["2 Day Job"] }, seed.sizing).duration_hint, "2 Day Job");
  });
});

describe("crews (step 5) — the hard rules as gates", () => {
  it("never Ethan + Bob", () => {
    const v = crew(["Ethan", "Bob", "Luke"]);
    assert.equal(v.valid, false);
    assert.ok(v.violations.some((x) => /never pair Ethan \+ Bob/.test(x)));
  });
  it("a crane crew needs an operator and three CDLs", () => {
    const noOp = crew(["Alex", "Luke", "Ian"], ["Treezilla"]);
    assert.ok(noOp.violations.some((x) => /operator/.test(x)));
    const ok = crew(["Ethan", "Nathan", "Ian"], ["Treezilla"]);
    assert.equal(ok.valid, true, ok.violations.join("; "));
    const twoCdl = crew(["Adam", "Ian", "James"], ["Treezilla"]);
    assert.ok(twoCdl.violations.some((x) => /3 CDL/.test(x)));
  });
  it("a 3-man crew needs two CDL drivers and a leader", () => {
    assert.ok(crew(["Bob", "James", "Aaron"]).violations.some((x) => /2 CDL/.test(x)));
    assert.ok(crew(["Luke", "Ian", "Aaron"]).violations.some((x) => /no crew leader/.test(x)));
    assert.equal(crew(["Bob", "James", "Luke"]).valid, true);
  });
  it("complex rigging needs Ethan, Alex or Adam — a trainee does not count alone", () => {
    const v = crew(["Bob", "Nathan", "Luke"], ["Heavy Rigging"]);
    assert.ok(v.violations.some((x) => /complex rigging/.test(x) && /trainee/.test(x)));
    assert.equal(crew(["Alex", "Nathan", "Luke"], ["Heavy Rigging"]).valid, true);
  });
  it("time off is a violation, and a split of the stable trio is only a warning", () => {
    const v = crew(["Bob", "James", "Ian"], [], ["Luke", "James"]);
    assert.ok(v.violations.some((x) => /James is off/.test(x)));
    assert.ok(v.soft_warnings.some((x) => /Bob\/James\/Luke/.test(x)));
  });
});

describe("equipment (step 6)", () => {
  it("flags a second crane job on one day and knows the rental", () => {
    const r = checkEquipment([{ id: "a", tags: ["Treezilla"] }, { id: "b", tags: ["50 Ton Knuckle Crane"] }, { id: "c", tags: ["Optional Treezilla"] }], seed.equipment);
    const crane = r.conflicts.find((c) => /crane/i.test(c.pool));
    assert.ok(crane && crane.jobs.length === 2 && /Erlinger/.test(crane.note ?? ""));
  });
  it("a combined tag claims both pools; four lifts do not collide", () => {
    const r = checkEquipment([{ id: "a", tags: ["Dino / Any Forwarding Machine"] }, { id: "b", tags: ["Nifty"] }, { id: "c", tags: ["Any Lift"] }], seed.equipment);
    assert.deepEqual(r.claims.map((c) => c.pool).sort(), ["Forwarder", "Lift"]);
    assert.equal(r.conflicts.length, 0);
  });
});

describe("routing (step 7)", () => {
  it("measures yard → stops → yard and picks the shortest order", () => {
    const zeitler = { id: "zeitler", lat: 38.7236, lng: -89.9559 };
    const macdonald = { id: "macdonald", lat: 38.7300, lng: -89.9700 };
    const alton = { id: "alton", lat: 38.8906, lng: -90.1843 };
    const r = routeDay([alton, zeitler, macdonald], seed.yard);
    assert.equal(r.order[0], "alton"); // Alton is on the yard's side; the two Maryville stops go together
    assert.ok(r.miles > 20 && r.miles < 60, String(r.miles));
    assert.equal(r.legs.length, 4);
    assert.equal(r.minutes, Math.round((r.miles / 35) * 60));
  });
});

describe("backlog (steps 2–3)", () => {
  it("removes hard blocks with reasons, nets stump, pools, ages and bands", async () => {
    const [unscheduled, scheduled, completed] = await Promise.all([
      hcp.jobs({ work_status: ["unscheduled"] }),
      hcp.jobs({ work_status: ["scheduled"], scheduled_start_min: "2026-09-14", scheduled_start_max: "2026-11-08" }),
      hcp.jobs({ work_status: ["completed"], scheduled_start_min: "2026-07-13", scheduled_start_max: TODAY }),
    ]);
    const lineItems = { job_u03: await hcp.lineItems("job_u03"), job_u13: await hcp.lineItems("job_u13") };
    const r = buildBacklog({ today: TODAY, unscheduled, scheduled, completed, trailingWeeks: 10, lineItems, unlockedTags: ["Wet weather work", "Needs To Be Dry"] }, seed);
    const reasons = Object.fromEntries(r.blocked.map((b) => [b.id, b.reason]));
    assert.match(reasons.job_u05!, /ON HOLD/);
    assert.match(reasons.job_u06!, /Ameren/);
    assert.match(reasons.job_u07!, /too wet/);
    assert.match(reasons.job_u08!, /Fall Work/);
    const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
    assert.equal(byId.job_u03!.tree_only, 8623); // $10,675 − $2,052 stump
    assert.equal(byId.job_u03!.stump_netted, 2052);
    assert.equal(byId.job_u02!.pool, "Crane");
    assert.equal(byId.job_u10!.pool_guessed, true); // no job_type
    assert.equal(byId.job_u04!.priority, true);
    assert.equal(byId.job_u09!.preempt, true);
    assert.equal(byId.job_s01!.source, "sunday_parked");
    assert.ok(byId.job_u11!.constraints.some((c) => /only on Tuesday/.test(c)));
    assert.equal(r.candidates[0]!.id, "job_u09"); // preempt first
    assert.equal(r.candidates[1]!.id, "job_u04"); // then priority
    const tree = r.windows.find((w) => w.pool === "Tree")!;
    const crane = r.windows.find((w) => w.pool === "Crane")!;
    assert.ok(tree.window_weeks! > 0 && crane.window_weeks! > 0);
    assert.notEqual(tree.window_weeks, crane.window_weeks); // never blended
    assert.equal(byId.job_u02!.band, "A"); // 55 days old vs a ~4.7-week crane window
  });
  it("tree-only equals total when nothing is bundled", () => {
    const j = { total: 175000 } as Parameters<typeof treeOnlyDollars>[0];
    assert.deepEqual(treeOnlyDollars(j, null), { tree_only: 1750, netted: 0 });
  });
});

describe("board", () => {
  it("decodes placeholders as crew labels and scores firm days against the target", async () => {
    const jobs = await hcp.jobs({ work_status: ["scheduled", "in_progress"], scheduled_start_min: "2026-09-21", scheduled_start_max: "2026-09-27" });
    const b = buildBoard(jobs, "2026-09-21", seed);
    const tue = b.crew_days.filter((c) => c.date === "2026-09-22");
    assert.equal(tue.length, 1);
    assert.equal(tue[0]!.crew, "Aaron, Alex, Luke");
    assert.equal(tue[0]!.firm, true);
    assert.equal(tue[0]!.dollars, 6000);
    assert.equal(tue[0]!.status, "built"); // inside 5,900–6,600
    const wedCrews = b.crew_days.filter((c) => c.date === "2026-09-23").map((c) => c.crew).sort();
    assert.deepEqual(wedCrews, ["Crew A", "Crew B"]);
    assert.ok(b.crew_days.find((c) => c.crew === "Crew A")!.firm === false);
    assert.deepEqual(b.unassigned.map((j) => j.id), ["job_s01"]); // the Sunday-parked job: on the week, nobody assigned
  });
});
