/**
 * Step 5 — every hard rule in crew_rules, as code. A crew that violates any
 * of them is invalid; soft rules are surfaced, never enforced.
 */
import type { FamilyValue } from "../config/schema";

export interface CrewCheck {
  members: string[];
  tags: string[];
  /** first names out that day, from get_time_off; "*" = everyone */
  out?: string[];
}

export interface CrewVerdict {
  valid: boolean;
  violations: string[];
  soft_warnings: string[];
  crane_job: boolean;
  leader: string | null;
  cdl_count: number;
}

export function validateCrew(check: CrewCheck, roster: FamilyValue<"roster">, rules: FamilyValue<"crew_rules">, equipment: FamilyValue<"equipment">): CrewVerdict {
  const v: string[] = [];
  const soft: string[] = [];
  const people = new Map(roster.people.map((p) => [p.name.toLowerCase(), p]));
  const members = check.members.map((m) => m.trim()).filter(Boolean);
  const found = members.map((m) => ({ name: m, p: people.get(m.toLowerCase()) ?? null }));
  for (const f of found) {
    if (!f.p) v.push(`${f.name} is not on the roster`);
    else if (!f.p.active) v.push(`${f.name} is inactive`);
  }
  const ps = found.flatMap((f) => (f.p ? [f.p] : []));
  const names = ps.map((p) => p.name);
  const has = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());
  const lowerTags = check.tags.map((t) => t.toLowerCase());
  const tagHit = (list: string[]) => list.some((t) => lowerTags.includes(t.toLowerCase()));
  const tagHasWord = (re: RegExp) => lowerTags.some((t) => re.test(t));

  for (const [a, b] of rules.hard.never_pair) if (has(a) && has(b)) v.push(`never pair ${a} + ${b}`);
  const leader = ps.find((p) => p.leader && rules.hard.leaders.some((l) => l.toLowerCase() === p.name.toLowerCase()))?.name ?? null;
  if (!leader) v.push(`no crew leader (one of ${rules.hard.leaders.join(", ")})`);
  const cdl = ps.filter((p) => p.cdl).length;

  const cranePool = equipment.pools.find((p) => /crane/i.test(p.pool));
  const craneJob = !!cranePool && tagHit(cranePool.tags) && !tagHasWord(/optional/);
  if (craneJob) {
    if (ps.length !== rules.hard.crane_crew_size) v.push(`crane crew must be ${rules.hard.crane_crew_size} people (have ${ps.length})`);
    if (cdl < rules.hard.min_cdl_crane_crew) v.push(`crane crew needs ${rules.hard.min_cdl_crane_crew} CDL drivers (have ${cdl})`);
    if (!ps.some((p) => p.crane_operator)) v.push(`crane crew needs an operator (${rules.hard.crane_operators.join(" or ")})`);
  } else if (ps.length >= 3 && cdl < rules.hard.min_cdl_standard_crew) {
    v.push(`a ${ps.length}-man crew needs ${rules.hard.min_cdl_standard_crew} CDL drivers (have ${cdl})`);
  }
  if (tagHit(rules.hard.complex_rigging_tags) && !ps.some((p) => p.complex_rigging === "yes")) {
    v.push(`complex rigging needs ${rules.hard.complex_rigging_qualified.join(", ")}${ps.some((p) => p.complex_rigging === "trainee") ? " (a trainee does not satisfy it alone)" : ""}`);
  }
  if (tagHit(rules.hard.climbing_tags) && !ps.some((p) => p.climb)) v.push("climbing job with no climber");
  const liftPool = equipment.pools.find((p) => /lift/i.test(p.pool));
  if (liftPool && tagHit(liftPool.tags) && !ps.some((p) => p.lift)) v.push("lift job with nobody lift-qualified");
  for (const n of rules.hard.cannot_run_lift) if (has(n) && liftPool && tagHit(liftPool.tags) && ps.filter((p) => p.lift).length === 0) v.push(`${n} cannot run a lift`);

  const out = check.out ?? [];
  for (const n of names) if (out.includes("*") || out.some((o) => o.toLowerCase() === n.toLowerCase())) v.push(`${n} is off that day`);

  if (has("Bob") || has("James") || has("Luke")) {
    const trio = ["Bob", "James", "Luke"].filter(has);
    if (trio.length > 0 && trio.length < 3) soft.push(`Bob/James/Luke split (${trio.join(", ")} here) — the one stable crew`);
  }
  return { valid: v.length === 0, violations: v, soft_warnings: soft, crane_job: craneJob, leader, cdl_count: cdl };
}
