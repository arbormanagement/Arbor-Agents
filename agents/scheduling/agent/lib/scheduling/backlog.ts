/**
 * Steps 2–3 — the candidate pool. Hard blocks come out first; what remains is
 * placed in a pool, priced on the TREE-ONLY amount, aged, and split by its
 * own pool's lead-time window. Sunday-parked jobs (scheduled, nobody
 * assigned) are Justin's "ready" queue and are candidates too.
 */
import type { FamilyValue } from "../config/schema";
import type { HcpJob, HcpLineItem } from "../hcp/types";
import { daysBetween, localDate, weekdayOf } from "./dates";

export type Pool = "Tree" | "Crane" | "Stump" | "PHC";

export interface Candidate {
  id: string;
  invoice: string | null;
  customer: string;
  description: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  tags: string[];
  pool: Pool;
  pool_guessed: boolean;
  total: number; // dollars
  tree_only: number; // dollars
  stump_netted: number; // dollars removed
  age_days: number;
  age_basis: "created_at";
  source: "unscheduled" | "sunday_parked" | "priority_scheduled";
  priority: boolean;
  preempt: boolean;
  constraints: string[]; // named day, notice, schedule with neighbours…
  band: "A" | "B" | null; // A = past its pool's window
  overdue_multiple: number | null;
}

export interface Blocked {
  id: string;
  invoice: string | null;
  customer: string;
  total: number;
  reason: string;
}

export interface PoolWindow {
  pool: Pool;
  backlog_dollars: number;
  trailing_weekly_completed_dollars: number;
  window_weeks: number | null;
  window_days: number | null;
}

export interface BacklogResult {
  today: string;
  candidates: Candidate[];
  blocked: Blocked[];
  windows: PoolWindow[];
  notes: string[];
}

export function customerName(j: HcpJob): string {
  return [j.customer.first, j.customer.last].filter(Boolean).join(" ") || "(no name)";
}

export function poolOf(j: HcpJob, equipment: FamilyValue<"equipment">): { pool: Pool; guessed: boolean } {
  const t = (j.job_type ?? "").toLowerCase();
  if (t) {
    if (t.includes("crane")) return { pool: "Crane", guessed: false };
    if (t.includes("stump")) return { pool: "Stump", guessed: false };
    if (t.includes("plant") || t.includes("phc")) return { pool: "PHC", guessed: false };
    return { pool: "Tree", guessed: false };
  }
  const text = `${j.description ?? ""} ${j.tags.join(" ")}`.toLowerCase();
  const crane = equipment.pools.find((p) => /crane/i.test(p.pool));
  if (crane && crane.tags.some((tag) => text.includes(tag.toLowerCase())) && !text.includes("optional treezilla")) return { pool: "Crane", guessed: true };
  if (/stump/.test(text)) return { pool: "Stump", guessed: true };
  if (/plant health|\bphc\b/.test(text)) return { pool: "PHC", guessed: true };
  return { pool: "Tree", guessed: true };
}

/** Tree-only dollars: total minus stump line items when the job carries stump work. */
export function treeOnlyDollars(j: HcpJob, lineItems: HcpLineItem[] | null): { tree_only: number; netted: number } {
  const total = j.total / 100;
  if (!lineItems) return { tree_only: total, netted: 0 };
  const stump = lineItems.filter((li) => /stump/i.test(li.name)).reduce((s, li) => s + li.amount, 0) / 100;
  return { tree_only: Math.max(0, round2(total - stump)), netted: round2(stump) };
}

export function hardBlock(j: HcpJob, hb: FamilyValue<"hard_blocks">, unlockedTags: string[] | null): string | null {
  const text = `${j.description ?? ""}`.toLowerCase();
  const tags = j.tags.map((t) => t.toLowerCase());
  if (text.includes(hb.on_hold_marker.toLowerCase()) || tags.includes(hb.on_hold_marker.toLowerCase())) return `${hb.on_hold_marker}: not schedulable`;
  for (const p of hb.date_restricted_patterns) {
    const pl = p.toLowerCase();
    if (text.includes(pl) || tags.some((t) => t.includes(pl))) return `date-restricted "${p}": only inside its window`;
  }
  for (const t of hb.utility_line_drop_tags) if (tags.includes(t.toLowerCase())) return `${t}: blocked until Justin confirms the Ameren drop date (${hb.utility_lead_time_weeks.min}–${hb.utility_lead_time_weeks.max} weeks lead)`;
  if (unlockedTags) {
    const dry = tags.find((t) => /needs to be|dryish|wet weather|possible wet/.test(t));
    if (dry && !unlockedTags.some((u) => u.toLowerCase() === dry)) return `ground too wet for tag: ${j.tags.find((t) => t.toLowerCase() === dry)}`;
  }
  return null;
}

export function constraintsOf(j: HcpJob, hb: FamilyValue<"hard_blocks">): string[] {
  const out: string[] = [];
  for (const t of j.tags) {
    if (/^(mon|tues|wednes|thurs|fri)day job$/i.test(t)) out.push(`only on ${t.replace(/ job$/i, "")}`);
    if (/notice/i.test(t)) out.push(`needs notice: ${t}`);
    if (/schedule with neighbors?/i.test(t)) out.push("same crew, same day as the neighbour's job");
    if (hb.not_a_blocker_tags.some((n) => n.toLowerCase() === t.toLowerCase())) out.push(`${t} (crew handles it same day — not a blocker)`);
  }
  return out;
}

export interface BacklogInputs {
  today: string;
  unscheduled: HcpJob[];
  /** scheduled jobs in a window around the target week (Sunday-parked + priority sweep) */
  scheduled: HcpJob[];
  /** completed jobs over the trailing window, for the lead-time formula */
  completed: HcpJob[];
  trailingWeeks: number;
  lineItems: Record<string, HcpLineItem[]>;
  unlockedTags: string[] | null;
}

export function buildBacklog(
  inp: BacklogInputs,
  cfg: { hard_blocks: FamilyValue<"hard_blocks">; tiers: FamilyValue<"tiers">; equipment: FamilyValue<"equipment"> },
): BacklogResult {
  const notes: string[] = [];
  const blocked: Blocked[] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const isPriority = (j: HcpJob) => j.tags.some((t) => cfg.tiers.priority_tags.some((p) => p.toLowerCase() === t.toLowerCase()));
  const isPreempt = (j: HcpJob) => cfg.tiers.preempt.some((p) => `${j.description ?? ""} ${j.tags.join(" ")}`.toLowerCase().includes(p.toLowerCase()));

  const consider = (j: HcpJob, source: Candidate["source"]) => {
    if (seen.has(j.id)) return;
    seen.add(j.id);
    const name = customerName(j);
    const reason = hardBlock(j, cfg.hard_blocks, inp.unlockedTags);
    if (reason) {
      blocked.push({ id: j.id, invoice: j.invoice, customer: name, total: j.total / 100, reason });
      return;
    }
    const { pool, guessed } = poolOf(j, cfg.equipment);
    if (guessed) notes.push(`${name} (${j.invoice ?? j.id}) has no job_type — placed in ${pool} by description; HCP cannot retype it`);
    const { tree_only, netted } = treeOnlyDollars(j, inp.lineItems[j.id] ?? null);
    candidates.push({
      id: j.id, invoice: j.invoice, customer: name, description: j.description, city: j.city, zip: j.zip, lat: j.lat, lng: j.lng, tags: j.tags,
      pool, pool_guessed: guessed, total: j.total / 100, tree_only, stump_netted: netted,
      age_days: daysBetween(localDate(j.created_at), inp.today), age_basis: "created_at", source,
      priority: isPriority(j), preempt: isPreempt(j), constraints: constraintsOf(j, cfg.hard_blocks), band: null, overdue_multiple: null,
    });
  };

  for (const j of inp.unscheduled) consider(j, "unscheduled");
  for (const j of inp.scheduled) {
    if (!j.start) continue;
    if (cfg.tiers.sunday_parked_is_ready_queue && weekdayOf(localDate(j.start)) === "Sun" && j.employees.length === 0) consider(j, "sunday_parked");
    else if (isPriority(j)) consider(j, "priority_scheduled");
  }

  // Lead-time window per pool, by revenue, never blended.
  const windows: PoolWindow[] = (["Tree", "Crane", "Stump", "PHC"] as Pool[]).map((pool) => {
    const backlog = candidates.filter((c) => c.pool === pool).reduce((s, c) => s + c.tree_only, 0);
    const done = inp.completed.filter((j) => poolOf(j, cfg.equipment).pool === pool).reduce((s, j) => s + j.total / 100, 0);
    const weekly = inp.trailingWeeks > 0 ? done / inp.trailingWeeks : 0;
    const weeks = weekly > 0 ? round2(backlog / weekly) : null;
    return { pool, backlog_dollars: round2(backlog), trailing_weekly_completed_dollars: round2(weekly), window_weeks: weeks, window_days: weeks === null ? null : Math.round(weeks * 7) };
  });
  const windowDays = new Map(windows.map((w) => [w.pool, w.window_days]));
  for (const c of candidates) {
    const wd = windowDays.get(c.pool) ?? null;
    if (wd === null || wd === 0) continue;
    c.band = c.age_days > wd ? "A" : "B";
    c.overdue_multiple = round2(c.age_days / wd);
  }
  candidates.sort((a, b) => Number(b.preempt) - Number(a.preempt) || Number(b.priority) - Number(a.priority) || Number(a.source === "sunday_parked") * -1 - Number(b.source === "sunday_parked") * -1 || (b.overdue_multiple ?? 0) - (a.overdue_multiple ?? 0));
  if (inp.unlockedTags === null) notes.push("dryness not applied: call get_ground_state first and pass unlocked_tags to drop wet-blocked work");
  notes.push("age is days since created_at; the office knows which jobs were on hold or date-restricted and did not accrue");
  return { today: inp.today, candidates, blocked, windows, notes };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
