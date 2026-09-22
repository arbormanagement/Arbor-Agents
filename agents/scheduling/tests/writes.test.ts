/**
 * The writes, end to end on the fixture, with the audit on memory AND PGlite.
 * notify:false is a property of the code path, not of the model's behaviour.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryWriteAudit, PostgresWriteAudit, newWriteId, type WriteAuditStore } from "../agent/lib/audit/store";
import { seed } from "../agent/lib/config/seed";
import { pgliteExecutor } from "../agent/lib/config/sql";
import { fixtureSource } from "../agent/lib/hcp/source";
import { chicagoIso, chicagoOffsetMinutes } from "../agent/lib/scheduling/dates";
import { personOnlyPolicy } from "../agent/lib/writes/policy";
import { WriteRefused, arrivalWindowFor, notifyCustomer, scheduleJob } from "../agent/lib/writes/schedule";

const dir = new URL("../evals/data/hcp", import.meta.url).pathname;
const cfg = { roster: seed.roster, crew_rules: seed.crew_rules, equipment: seed.equipment, day_shape: seed.day_shape, write_policy: seed.write_policy };
const rosterNames = seed.roster.people.map((p) => p.name);
const keys = (call: string) => ({ session_id: "s1", turn_id: "t1", call_id: call });
const id = (call: string) => newWriteId(`write_schedule:s1:t1:${call}`);
const backends: Array<[string, () => Promise<WriteAuditStore>]> = [
  ["memory", async () => new InMemoryWriteAudit()],
  ["pglite", async () => PostgresWriteAudit.create(await pgliteExecutor())],
];

describe("chicago time", () => {
  it("renders local HH:MM with the right offset across DST", () => {
    assert.equal(chicagoIso("2026-09-28", "08:00"), "2026-09-28T08:00:00-05:00"); // CDT
    assert.equal(chicagoIso("2026-12-01", "08:00"), "2026-12-01T08:00:00-06:00"); // CST
    assert.equal(chicagoOffsetMinutes(new Date("2026-07-01T12:00:00Z")), -300);
    assert.equal(new Date(chicagoIso("2026-09-28", "08:00")).toISOString(), "2026-09-28T13:00:00.000Z");
  });
  it("arrival windows follow day_shape", () => {
    const base = { job_id: "x", date: "2026-09-28", start: "08:00", end: "10:00", crew: [] };
    assert.equal(arrivalWindowFor({ ...base, first_job_of_day: true, kind: "standard" }, seed.day_shape), 60);
    assert.equal(arrivalWindowFor({ ...base, first_job_of_day: false, kind: "standard" }, seed.day_shape), 120);
    assert.equal(arrivalWindowFor({ ...base, first_job_of_day: false, kind: "phc" }, seed.day_shape), 120);
    assert.equal(arrivalWindowFor({ ...base, first_job_of_day: true, kind: "emergency" }, seed.day_shape), null);
  });
});

for (const [name, open] of backends) {
  describe(`write_schedule [${name}]`, () => {
    const good = { job_id: "job_u01", date: "2026-09-28", start: "08:00", end: "10:00", crew: ["Alex", "Ian", "Aaron"], first_job_of_day: true, kind: "standard" as const };

    it("writes with notify hard-coded false, dispatches the crew, records the audit", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      const out = await scheduleJob({ hcp, audit, cfg, rosterNames }, good, "elizabeth@arbor-mgmt.com", keys("c1"), id("c1"));
      assert.equal(out.replay, false);
      assert.equal(out.hcp_call.notify, false);
      assert.equal(out.hcp_call.notify_pro, false);
      assert.equal(out.hcp_call.scheduled_start, "2026-09-28T08:00:00-05:00");
      assert.deepEqual(out.hcp_call.employee_ids, ["pro_alex", "pro_ian", "pro_aaron"]);
      assert.equal(out.hcp_call.arrival_window_minutes, 60);
      assert.equal(hcp.writes.length, 1);
      const rows = await audit.forJob("job_u01");
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.status, "done");
      assert.equal(rows[0]!.actor, "elizabeth@arbor-mgmt.com");
      assert.equal((await hcp.job("job_u01"))!.status, "scheduled");
    });

    it("refuses an invalid crew, a member who is off, and a non-production day", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      await assert.rejects(scheduleJob({ hcp, audit, cfg, rosterNames }, { ...good, crew: ["Ethan", "Bob", "Luke"] }, "x", keys("c2"), id("c2")), /never pair Ethan \+ Bob/);
      await assert.rejects(scheduleJob({ hcp, audit, cfg, rosterNames }, { ...good, crew: ["Alex", "Luke", "Aaron"] }, "x", keys("c3"), id("c3")), /Luke is off/); // Luke's series runs into 9/28
      await assert.rejects(scheduleJob({ hcp, audit, cfg, rosterNames }, { ...good, date: "2026-10-02" }, "x", keys("c4"), id("c4")), /Fri/); // production days Mon–Thu
      assert.equal(hcp.writes.length, 0, "nothing reached HCP");
      assert.equal((await audit.forJob("job_u01")).length, 0, "nothing was recorded either — refusals happen before the audit row");
    });

    it("a replayed step returns the recorded result and does not write twice", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      const a = await scheduleJob({ hcp, audit, cfg, rosterNames }, good, "x", keys("c5"), id("c5"));
      const b = await scheduleJob({ hcp, audit, cfg, rosterNames }, good, "x", keys("c5"), id("c5"));
      assert.equal(a.replay, false);
      assert.equal(b.replay, true);
      assert.equal(b.audit_id, a.audit_id);
      assert.equal(hcp.writes.length, 1);
    });

    it("a second, different move of the same job in one turn is a real write (different call id)", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      await scheduleJob({ hcp, audit, cfg, rosterNames }, good, "x", keys("c6"), id("c6"));
      await scheduleJob({ hcp, audit, cfg, rosterNames }, { ...good, date: "2026-09-29" }, "x", keys("c7"), id("c7"));
      assert.equal(hcp.writes.length, 2);
      assert.equal((await audit.forJob("job_u01")).length, 2);
    });

    it("an interrupted (pending) schedule write is safe to send again", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      await audit.begin({ id: id("c8"), kind: "write_schedule", job_id: "job_u01", actor: "x", ...keys("c8"), request: {} }); // as if cut off before HCP answered
      const out = await scheduleJob({ hcp, audit, cfg, rosterNames }, good, "x", keys("c8"), id("c8"));
      assert.equal(out.replay, false);
      assert.equal(hcp.writes.length, 1);
      assert.equal((await audit.forJob("job_u01"))[0]!.status, "done");
    });
  });

  describe(`notify_customer [${name}]`, () => {
    it("refuses an unscheduled job, sends notify:true for a scheduled one, and is a no-op on replay", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      await assert.rejects(notifyCustomer({ hcp, audit }, "job_u01", "x", keys("n1"), newWriteId("notify:n1")), /not scheduled/);
      const a = await notifyCustomer({ hcp, audit }, "job_b04", "kwilliams@arbor-mgmt.com", keys("n2"), newWriteId("notify:n2"));
      assert.equal(a.hcp_call.notify, true);
      assert.equal(a.hcp_call.scheduled_start, "2026-09-23T13:00:00Z"); // the existing schedule, unchanged
      assert.equal(a.hcp_call.employee_ids, undefined);
      const b = await notifyCustomer({ hcp, audit }, "job_b04", "kwilliams@arbor-mgmt.com", keys("n2"), newWriteId("notify:n2"));
      assert.equal(b.replay, true);
      assert.equal(hcp.writes.filter((w) => w.notify).length, 1, "the customer was texted exactly once");
    });

    it("never re-sends a text whose first attempt is unresolved", async () => {
      const hcp = fixtureSource(dir);
      const audit = await open();
      const aid = newWriteId("notify:n3");
      await audit.begin({ id: aid, kind: "notify_customer", job_id: "job_b04", actor: "x", ...keys("n3"), request: {} });
      await assert.rejects(notifyCustomer({ hcp, audit }, "job_b04", "x", keys("n3"), aid), (e: unknown) => e instanceof WriteRefused && /unresolved/.test(e.message));
      assert.equal(hcp.writes.length, 0);
    });
  });
}

describe("write approval policy", () => {
  const ctx = (current: { authenticator: string; principalId: string; principalType: string } | null) => ({ session: { auth: { current: current ? { ...current, attributes: {} } : null } } });
  it("lets an allowlisted person through and denies everyone else with a reason", () => {
    assert.equal(personOnlyPolicy(ctx({ authenticator: "gchat", principalId: "nic@arbor-mgmt.com", principalType: "user" })), "not-applicable");
    const oidc = personOnlyPolicy(ctx({ authenticator: "oidc", principalId: "owner:x:project:y:environment:production", principalType: "service" }));
    assert.equal(typeof oidc === "object" && oidc.type, "denied");
    const app = personOnlyPolicy(ctx({ authenticator: "app", principalId: "eve:app", principalType: "runtime" }));
    assert.equal(typeof app === "object" && app.type, "denied");
    assert.equal(typeof personOnlyPolicy(ctx(null)) === "object", true);
  });
});
