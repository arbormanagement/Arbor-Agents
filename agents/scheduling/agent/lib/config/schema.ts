/**
 * Config families — the parameters the scheduling skill used to hard-code,
 * now typed records the office edits by chatting.
 *
 * Every schema is a strict object: unknown keys are rejected at write time.
 * That is the property that makes chat-editing safe — there is a field for a
 * crew-pairing rule; there is no field for "ignore the CDL requirement".
 *
 * Source of the seed values: arbor-general/.claude/skills/job-scheduling/SKILL.md v1.10
 * and scheduling/SCHEDULING_PLAYBOOK.md. Plan: arbor-general/docs/EVE_SCHEDULING_AGENT_PLAN.md §3.1
 */
import { z } from "zod";

const person = z.string().min(1);
const tag = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const rosterSchema = z.strictObject({
  people: z.array(
    z.strictObject({
      name: person,
      climb: z.boolean(),
      complex_rigging: z.enum(["yes", "trainee", "no"]),
      crane_operator: z.boolean(),
      lift: z.boolean(),
      leader: z.boolean(),
      cdl: z.boolean(),
      active: z.boolean(),
      started: isoDate.optional(),
      note: z.string().optional(),
    }),
  ),
});

export const crewRulesSchema = z.strictObject({
  hard: z.strictObject({
    never_pair: z.array(z.tuple([person, person])),
    leaders: z.array(person).min(1),
    max_crews: z.number().int().positive(),
    min_cdl_standard_crew: z.number().int().nonnegative(),
    min_cdl_crane_crew: z.number().int().nonnegative(),
    crane_crew_size: z.number().int().positive(),
    crane_operators: z.array(person).min(1),
    complex_rigging_qualified: z.array(person).min(1),
    complex_rigging_tags: z.array(tag),
    climbing_tags: z.array(tag),
    cannot_run_lift: z.array(person),
  }),
  soft: z.array(z.strictObject({ rule: z.string().min(1), why: z.string().optional() })),
});

export const equipmentSchema = z.strictObject({
  pools: z.array(
    z.strictObject({
      pool: z.string().min(1),
      count: z.number().int().nonnegative(),
      tags: z.array(tag).min(1),
      single_point: z.boolean(),
      rental: z.strictObject({ item: z.string(), from: z.string() }).optional(),
      note: z.string().optional(),
    }),
  ),
  tag_notes: z.array(z.strictObject({ tag: tag, meaning: z.string() })),
});

export const dollarTargetsSchema = z.strictObject({
  mode: z.enum(["quota_8h"]),
  targets: z.strictObject({
    two_man: z.strictObject({ low: z.number(), high: z.number() }),
    three_man: z.strictObject({ low: z.number(), high: z.number() }),
    four_man: z.strictObject({ low: z.number(), high: z.number() }),
  }),
  note: z.string().optional(),
});

export const dayShapeSchema = z.strictObject({
  block_start: z.string().regex(/^\d{2}:\d{2}$/),
  block_end: z.string().regex(/^\d{2}:\d{2}$/),
  production_days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])),
  buffer_minutes: z.strictObject({ min: z.number().int(), max: z.number().int() }),
  arrival_window_minutes: z.strictObject({
    first_job: z.number().int(),
    later_job: z.number().int(),
    phc_stop: z.number().int(),
    emergency: z.number().int().nullable(),
  }),
});

export const sizingSchema = z.strictObject({
  crew_hour_rate: z.number().positive(),
  three_man_elapsed_rate: z.number().positive(),
  round_up_minutes: z.number().int().positive(),
  table: z.array(
    z.strictObject({
      max_price_exclusive: z.number().nullable(),
      block_hours: z.number().nullable(),
      full_day: z.boolean(),
    }),
  ),
  adjustments: z.strictObject({
    two_man_multiplier: z.number(),
    four_man_multiplier: z.number(),
    crane_hours: z.number(),
    crane_full_day_lock: z.boolean(),
    land_clearing_min_hours: z.number(),
    land_clearing_full_day_lock_over: z.number(),
    phc_stop_minutes: z.number(),
    emergency_hours: z.number(),
    emergency_clears_crew_day: z.boolean(),
  }),
  over_price_ask: z.number(),
  duration_hint_tags: z.array(tag),
  size_on_tree_only_price: z.boolean(),
});

export const drynessSchema = z.strictObject({
  weather_point: z.strictObject({ latitude: z.number(), longitude: z.number() }),
  past_days: z.number().int(),
  forecast_days: z.number().int(),
  severe_event_inches: z.number(),
  tiers: z.array(
    z.strictObject({
      state: z.string().min(1),
      dry_days_min: z.number().int(),
      dry_days_max: z.number().int().nullable(),
      unlocks_tags: z.array(tag),
    }),
  ),
  severe_requires_human: z.boolean(),
});

export const hardBlocksSchema = z.strictObject({
  on_hold_marker: z.string().min(1),
  date_restricted_patterns: z.array(z.string().min(1)),
  named_day_pattern: z.string().min(1),
  notice_pattern: z.string().min(1),
  utility_line_drop_tags: z.array(tag),
  utility_lead_time_weeks: z.strictObject({ min: z.number(), max: z.number() }),
  not_a_blocker_tags: z.array(tag),
  irrelevant_tags: z.array(z.string().min(1)),
});

export const tiersSchema = z.strictObject({
  preempt: z.array(z.string().min(1)),
  priority_tags: z.array(tag),
  sunday_parked_is_ready_queue: z.boolean(),
  pools: z.array(
    z.strictObject({
      pool: z.string().min(1),
      capacity: z.string().min(1),
      competes_with_crews: z.boolean(),
    }),
  ),
  lead_time_formula: z.string().min(1),
  lead_time_by_revenue_not_count: z.boolean(),
  age_clock_starts_when_schedulable: z.boolean(),
});

export const placeholdersSchema = z.strictObject({
  map: z.array(z.strictObject({ assignee: person, crew: z.string().min(1) })),
  real_names_mean_firm: z.boolean(),
});

export const yardSchema = z.strictObject({
  address: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  road_factor: z.number().positive(),
  loaded_mph: z.number().positive(),
  density_zips: z.array(z.string().regex(/^\d{5}$/)),
});

export const stormProtocolSchema = z.strictObject({
  designated_crew_history: z.array(person),
  block_hours: z.number(),
  displaced_work_moves_to: z.enum(["Fri"]),
  call_displaced_customers_same_day: z.boolean(),
});

export const overtimeSchema = z.strictObject({
  workweek: z.enum(["Sun-Sat"]),
  threshold_hours: z.number(),
  premium_per_hour: z.number(),
  never_decline_emergency: z.boolean(),
  revenue_per_man_hour: z.strictObject({ tree: z.number(), crane: z.number(), emergency: z.number() }),
});

export const siteNotesSchema = z.strictObject({
  notes: z.array(
    z.strictObject({
      match: z.strictObject({ customer: z.string().optional(), address: z.string().optional() }),
      note: z.string().min(1),
    }),
  ),
});

export const knownOneDaySchema = z.strictObject({
  jobs: z.array(z.strictObject({ invoice: z.string().min(1), customer: z.string().optional(), note: z.string().optional() })),
});

export const writePolicySchema = z.strictObject({
  /** HCP texts the assigned crew when a job is scheduled. Off for tentative boards; the office decides. */
  notify_pro_on_schedule: z.boolean(),
  note: z.string().optional(),
});

export const familySchemas = {
  roster: rosterSchema,
  crew_rules: crewRulesSchema,
  equipment: equipmentSchema,
  dollar_targets: dollarTargetsSchema,
  day_shape: dayShapeSchema,
  sizing: sizingSchema,
  dryness: drynessSchema,
  hard_blocks: hardBlocksSchema,
  tiers: tiersSchema,
  placeholders: placeholdersSchema,
  yard: yardSchema,
  storm_protocol: stormProtocolSchema,
  overtime: overtimeSchema,
  site_notes: siteNotesSchema,
  known_one_day: knownOneDaySchema,
  write_policy: writePolicySchema,
} as const;

export type Family = keyof typeof familySchemas;
export const FAMILIES = Object.keys(familySchemas) as Family[];
export const familyEnum = z.enum(FAMILIES as [Family, ...Family[]]);

export type FamilyValue<F extends Family> = z.infer<(typeof familySchemas)[F]>;

/** Validate a value for a family. Throws a ZodError on failure. */
export function parseFamilyValue<F extends Family>(family: F, value: unknown): FamilyValue<F> {
  return familySchemas[family].parse(value) as FamilyValue<F>;
}

/** The provenance envelope every stored record carries. Nothing is deleted — superseded. */
export const configRecordSchema = z.strictObject({
  id: z.string().min(1),
  family: familyEnum,
  value: z.unknown(),
  set_by: z.string().min(1),
  set_at: z.string().min(1),
  evidence: z.string().optional(),
  superseded_by: z.string().optional(),
});
export type ConfigRecord = z.infer<typeof configRecordSchema>;
