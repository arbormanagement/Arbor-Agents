/**
 * Step 4 — size a job from its TREE-ONLY price. The table has no rung above
 * "full day", so anything over the ask threshold returns ask=true with the
 * implied crew-hours printed; the office says whether it is one day or more.
 */
import type { FamilyValue } from "../config/schema";

export interface SizeInput {
  tree_only_price: number; // dollars
  crew_size: 2 | 3 | 4;
  tags: string[];
  job_type?: string | null;
  description?: string | null;
}

export interface SizeResult {
  block_hours: number | null;
  full_day: boolean;
  ask: boolean;
  implied_crew_hours: number;
  basis: string;
  duration_hint: string | null;
}

export function sizeJob(input: SizeInput, sizing: FamilyValue<"sizing">): SizeResult {
  const price = input.tree_only_price;
  const text = `${input.job_type ?? ""} ${input.description ?? ""} ${input.tags.join(" ")}`.toLowerCase();
  const implied = round1(price / sizing.three_man_elapsed_rate);
  const hint = input.tags.find((t) => sizing.duration_hint_tags.some((h) => h.toLowerCase() === t.toLowerCase())) ?? null;
  const ask = price > sizing.over_price_ask;
  const adj = sizing.adjustments;

  const roundUp = (h: number) => Math.ceil((h * 60) / sizing.round_up_minutes) * (sizing.round_up_minutes / 60);
  const crewAdjust = (h: number) => roundUp(input.crew_size === 2 ? h * adj.two_man_multiplier : input.crew_size === 4 ? h * adj.four_man_multiplier : h);

  if (/\bemergency\b/.test(text)) {
    return { block_hours: adj.emergency_hours, full_day: adj.emergency_clears_crew_day, ask, implied_crew_hours: implied, basis: "emergency: fixed block, clears the crew's day", duration_hint: hint };
  }
  if (/\bphc\b|plant health/.test(text)) {
    return { block_hours: round1(adj.phc_stop_minutes / 60), full_day: false, ask: false, implied_crew_hours: implied, basis: "PHC stop", duration_hint: hint };
  }
  if (/\bcrane\b|treezilla|knuckle/.test(text) && !/optional treezilla/.test(text)) {
    return { block_hours: adj.crane_hours, full_day: adj.crane_full_day_lock, ask, implied_crew_hours: implied, basis: "crane: fixed block, full-day lock", duration_hint: hint };
  }
  if (/land clearing/.test(text)) {
    const full = price > adj.land_clearing_full_day_lock_over;
    return { block_hours: full ? null : Math.max(adj.land_clearing_min_hours, crewAdjust(tableHours(price, sizing) ?? adj.land_clearing_min_hours)), full_day: full, ask, implied_crew_hours: implied, basis: full ? "land clearing over the lock price: full day" : "land clearing: minimum block", duration_hint: hint };
  }
  const rung = sizing.table.find((r) => r.max_price_exclusive === null || price < r.max_price_exclusive) ?? sizing.table[sizing.table.length - 1]!;
  if (rung.full_day) {
    return { block_hours: null, full_day: true, ask, implied_crew_hours: implied, basis: ask ? `over $${sizing.over_price_ask}: full day — ASK whether one day or more (${implied} implied crew-hours at $${sizing.three_man_elapsed_rate}/h)` : "full day", duration_hint: hint };
  }
  return { block_hours: crewAdjust(rung.block_hours!), full_day: false, ask: false, implied_crew_hours: implied, basis: `table rung under $${rung.max_price_exclusive} for a ${input.crew_size}-man crew`, duration_hint: hint };
}

function tableHours(price: number, sizing: FamilyValue<"sizing">): number | null {
  const rung = sizing.table.find((r) => r.max_price_exclusive === null || price < r.max_price_exclusive);
  return rung?.block_hours ?? null;
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
