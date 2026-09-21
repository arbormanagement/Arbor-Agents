/**
 * Step 1A — read time off correctly. HCP returns the PARENT event only; a
 * multi-day absence is one row plus a recurrence_rule. Expand it, intersect
 * with the target days, and report who is out on which day and why.
 */
import type { HcpEvent } from "../hcp/types";
import { addDays, localDate } from "./dates";

const ABSENCE = /\b(off|sick|injur|closed)\b/i;
const NOT_ABSENCE = /\b(available|on call|bids|crew configuration)\b/i;
const EVERYONE = /\bclosed\b/i;

export interface Absence {
  date: string;
  person: string; // first name; "*" = everyone (company closed)
  event_id: string;
  event_name: string;
  from_rule: boolean;
  note?: string;
}

/** Concrete dates for one event. Unknown FREQ falls back to the single start date and says so. */
export function expandRecurrence(startYmd: string, rule: string | null, cap = 400): { dates: string[]; note?: string } {
  if (!rule) return { dates: [startYmd] };
  const parts = Object.fromEntries(rule.split(";").map((kv) => kv.split("=") as [string, string]).map(([k, v]) => [k.toUpperCase(), v ?? ""]));
  const freq = parts.FREQ;
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const step = freq === "DAILY" ? interval : freq === "WEEKLY" ? 7 * interval : null;
  if (step === null) return { dates: [startYmd], note: `unsupported FREQ=${freq ?? "?"}; treated as one day` };
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  const until = parts.UNTIL ? parts.UNTIL.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : null;
  const dates: string[] = [];
  for (let i = 0, d = startYmd; i < cap; i++, d = addDays(d, step)) {
    if (count !== null && dates.length >= count) break;
    if (until !== null && d > until) break;
    dates.push(d);
    if (count === null && until === null) break; // no bound → single occurrence
  }
  return { dates };
}

/** Which people (first names) an event takes out. Assigned employees win; "CLOSED" means everyone. */
export function absentPeople(event: HcpEvent, rosterNames: string[]): string[] {
  if (NOT_ABSENCE.test(event.name)) return [];
  if (EVERYONE.test(event.name)) return ["*"];
  if (!ABSENCE.test(event.name)) return [];
  if (event.employees.length > 0) return event.employees;
  // "Nic & Eli OFF" — no assignment; best effort from the title against the
  // roster: a whole name, or a nickname that is a prefix of at least 3 letters.
  const tokens = event.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  return rosterNames.filter((n) => tokens.some((t) => n.toLowerCase() === t || n.toLowerCase().startsWith(t)));
}

/** Absences on the given days, one row per (day, person). */
export function absencesFor(events: HcpEvent[], days: string[], rosterNames: string[]): Absence[] {
  const want = new Set(days);
  const out: Absence[] = [];
  for (const e of events) {
    const people = absentPeople(e, rosterNames);
    if (people.length === 0) continue;
    const { dates, note } = expandRecurrence(localDate(e.start), e.recurrence_rule);
    for (const date of dates) {
      if (!want.has(date)) continue;
      for (const person of people) out.push({ date, person, event_id: e.id, event_name: e.name, from_rule: !!e.recurrence_rule, ...(note ? { note } : {}) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person));
}

/** { date → people out } including "*". */
export function outByDay(absences: Absence[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const a of absences) (m[a.date] ??= []).includes(a.person) || m[a.date]!.push(a.person);
  return m;
}
