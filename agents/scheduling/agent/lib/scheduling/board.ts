/**
 * The current board for a week: per day, per crew, jobs in order, dollars vs
 * the crew-day target, blocks and buffer. Placeholder assignees (Nic / Justin /
 * Elizabeth) mean a crew LABEL on a tentative board, not an empty day.
 */
import type { FamilyValue } from "../config/schema";
import type { HcpJob } from "../hcp/types";
import { hoursBetween, localDate, weekDays } from "./dates";
import { customerName } from "./backlog";

export interface BoardJob {
  id: string;
  invoice: string | null;
  customer: string;
  description: string | null;
  start: string; // ISO
  end: string | null;
  block_hours: number | null;
  total: number; // dollars
  tags: string[];
  city: string | null;
  zip: string | null;
}

export interface CrewDay {
  date: string;
  crew: string; // "Crew A" (placeholder) or "Alex, Luke, Aaron"
  members: string[];
  firm: boolean;
  jobs: BoardJob[];
  dollars: number;
  block_hours: number;
  target: { low: number; high: number } | null;
  status: "under" | "built" | "over" | "unknown";
}

export interface Board {
  week_start: string;
  days: string[];
  crew_days: CrewDay[];
  unassigned: BoardJob[];
  notes: string[];
}

export function buildBoard(jobs: HcpJob[], weekStart: string, cfg: { placeholders: FamilyValue<"placeholders">; dollar_targets: FamilyValue<"dollar_targets"> }): Board {
  const days = weekDays(weekStart);
  const inWeek = new Set(days);
  const placeholder = new Map(cfg.placeholders.map.map((m) => [m.assignee.toLowerCase(), m.crew]));
  const groups = new Map<string, CrewDay>();
  const unassigned: BoardJob[] = [];
  for (const j of jobs) {
    if (!j.start) continue;
    const date = localDate(j.start);
    if (!inWeek.has(date)) continue;
    const bj: BoardJob = {
      id: j.id, invoice: j.invoice, customer: customerName(j), description: j.description, start: j.start, end: j.end,
      block_hours: j.end ? round1(hoursBetween(j.start, j.end)) : null, total: j.total / 100, tags: j.tags, city: j.city, zip: j.zip,
    };
    if (j.employees.length === 0) {
      unassigned.push(bj);
      continue;
    }
    const labels = j.employees.map((e) => placeholder.get(e.toLowerCase()));
    const isPlaceholder = labels.some(Boolean);
    const crew = isPlaceholder ? labels.filter(Boolean).join("+") : [...j.employees].sort().join(", ");
    const key = `${date}|${crew}`;
    let cd = groups.get(key);
    if (!cd) {
      cd = { date, crew, members: isPlaceholder ? [] : [...j.employees].sort(), firm: !isPlaceholder && cfg.placeholders.real_names_mean_firm, jobs: [], dollars: 0, block_hours: 0, target: null, status: "unknown" };
      groups.set(key, cd);
    }
    cd.jobs.push(bj);
  }
  const crewDays = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.crew.localeCompare(b.crew));
  for (const cd of crewDays) {
    cd.jobs.sort((a, b) => a.start.localeCompare(b.start));
    cd.dollars = round2(cd.jobs.reduce((s, j) => s + j.total, 0));
    cd.block_hours = round1(cd.jobs.reduce((s, j) => s + (j.block_hours ?? 0), 0));
    const size = cd.members.length;
    const t = cfg.dollar_targets.targets;
    cd.target = size === 2 ? t.two_man : size === 3 ? t.three_man : size >= 4 ? t.four_man : null;
    cd.status = !cd.target ? "unknown" : cd.dollars < cd.target.low ? "under" : cd.dollars > cd.target.high ? "over" : "built";
  }
  const notes: string[] = [];
  if (crewDays.some((c) => !c.firm)) notes.push("placeholder assignees (Nic/Justin/Elizabeth) = crew labels on a tentative board, fully crewed — not empty days; targets need a real crew size");
  if (unassigned.length) notes.push(`${unassigned.length} job(s) on the week with nobody assigned`);
  return { week_start: weekStart, days, crew_days: crewDays, unassigned: unassigned.sort((a, b) => a.start.localeCompare(b.start)), notes };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
