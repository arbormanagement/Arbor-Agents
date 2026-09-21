/**
 * Step 1 — ground conditions gate everything. Group rain days into events,
 * classify the latest, count dry days, map to a tier. A SEVERE event has no
 * table: it is a human call, so the result says ask=true and stops there.
 */
import type { FamilyValue } from "../config/schema";

export interface RainEvent {
  start: string;
  end: string;
  total_inches: number;
  max_day_inches: number;
}

export interface GroundState {
  today: string;
  last_event: RainEvent | null;
  severe: boolean;
  /** Severe → the office decides; no tier is applied. */
  ask: boolean;
  dry_days: number | null;
  tier: string | null;
  unlocked_tags: string[];
  forecast: Array<{ date: string; inches: number }>;
  rain_ahead: Array<{ date: string; inches: number }>;
  note: string;
}

const MEASURABLE = 0.01;

export function groundState(daily: Array<{ date: string; inches: number }>, todayYmd: string, dryness: FamilyValue<"dryness">): GroundState {
  const past = daily.filter((d) => d.date <= todayYmd);
  const forecast = daily.filter((d) => d.date > todayYmd);
  const events: RainEvent[] = [];
  for (const d of past) {
    if (d.inches < MEASURABLE) continue;
    const last = events[events.length - 1];
    if (last && isNextDay(last.end, d.date)) {
      last.end = d.date;
      last.total_inches = round2(last.total_inches + d.inches);
      last.max_day_inches = Math.max(last.max_day_inches, d.inches);
    } else events.push({ start: d.date, end: d.date, total_inches: round2(d.inches), max_day_inches: d.inches });
  }
  const last = events[events.length - 1] ?? null;
  const severe = !!last && (last.max_day_inches > dryness.severe_event_inches || last.total_inches > dryness.severe_event_inches);
  const dryDays = last ? Math.max(0, daysDiff(last.end, todayYmd)) : past.length;
  const rainAhead = forecast.filter((d) => d.inches >= MEASURABLE);
  if (severe && dryness.severe_requires_human) {
    return {
      today: todayYmd, last_event: last, severe, ask: true, dry_days: dryDays, tier: null, unlocked_tags: [],
      forecast, rain_ahead: rainAhead,
      note: `SEVERE event ${last!.start}..${last!.end} totalling ${last!.total_inches}" (max day ${last!.max_day_inches}"); ${dryDays} dry days since. No tier applies — the office decides what dryness-tagged work runs. Untagged / Normal Conditions work proceeds.`,
    };
  }
  const tiers = [...dryness.tiers].sort((a, b) => a.dry_days_min - b.dry_days_min);
  const tier = tiers.filter((t) => dryDays >= t.dry_days_min && (t.dry_days_max === null || dryDays <= t.dry_days_max)).pop() ?? tiers[tiers.length - 1]!;
  const unlocked = tiers.filter((t) => t.dry_days_min <= tier.dry_days_min).flatMap((t) => t.unlocks_tags);
  return {
    today: todayYmd, last_event: last, severe: false, ask: false, dry_days: dryDays, tier: tier.state, unlocked_tags: unlocked,
    forecast, rain_ahead: rainAhead,
    note: last ? `Standard event ${last.start}..${last.end} totalling ${last.total_inches}"; ${dryDays} dry days → ${tier.state}.` : `No measurable rain in the window → ${tier.state}.`,
  };
}

function isNextDay(a: string, b: string) {
  return daysDiff(a, b) === 1;
}
function daysDiff(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
