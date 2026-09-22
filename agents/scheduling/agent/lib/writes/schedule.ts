/**
 * The two writes, as orchestration with injected dependencies so the whole
 * path is unit-testable on the fixture and on PGlite:
 *
 *   scheduleJob  — THE schedule write. notify is hard-coded false here and is
 *                  not an input anything upstream can set.
 *   notifyCustomer — the one irreversible action: the customer text.
 *
 * Both record the write in the audit BEFORE calling HCP (plan §5.3). On a
 * replay the row already exists: done → return its result, nothing re-sent;
 * pending → a schedule write is safe to send again (setting the same
 * schedule twice is harmless), a customer text is NOT, so it refuses.
 */
import type { FamilyValue } from "../config/schema";
import type { WriteAuditStore, WriteRecord } from "../audit/store";
import type { HcpEmployee, HcpSource, ScheduleWrite } from "../hcp/types";
import { validateCrew, type CrewVerdict } from "../scheduling/crews";
import { chicagoIso, weekdayOf } from "../scheduling/dates";
import { absencesFor, outByDay } from "../scheduling/time-off";

export interface WriteKeys {
  session_id: string;
  turn_id: string;
  call_id: string;
}

export interface ScheduleInput {
  job_id: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM Chicago
  end: string; // HH:MM Chicago
  crew: string[]; // roster first names
  first_job_of_day: boolean;
  kind: "standard" | "phc" | "emergency";
}

export interface ScheduleConfig {
  roster: FamilyValue<"roster">;
  crew_rules: FamilyValue<"crew_rules">;
  equipment: FamilyValue<"equipment">;
  day_shape: FamilyValue<"day_shape">;
  write_policy: FamilyValue<"write_policy">;
}

export interface ScheduleOutcome {
  ok: true;
  replay: boolean;
  audit_id: string;
  job_id: string;
  customer: string;
  scheduled: { date: string; weekday: string; start: string; end: string; arrival_window_minutes: number | null; crew: string[] };
  crew_check: CrewVerdict;
  /** The exact HCP call, so an eval can hold the line on notify. */
  hcp_call: ScheduleWrite;
  hcp_result: unknown;
}

export class WriteRefused extends Error {}

export function employeeIdsFor(names: string[], employees: HcpEmployee[]): string[] {
  return names.map((n) => {
    const e = employees.find((x) => x.first_name.toLowerCase() === n.trim().toLowerCase());
    if (!e) throw new WriteRefused(`${n} is not a HousecallPro employee; cannot dispatch`);
    return e.id;
  });
}

export function arrivalWindowFor(input: ScheduleInput, day: FamilyValue<"day_shape">): number | null {
  if (input.kind === "emergency") return day.arrival_window_minutes.emergency;
  if (input.kind === "phc") return day.arrival_window_minutes.phc_stop;
  return input.first_job_of_day ? day.arrival_window_minutes.first_job : day.arrival_window_minutes.later_job;
}

export async function scheduleJob(
  deps: { hcp: HcpSource; audit: WriteAuditStore; cfg: ScheduleConfig; rosterNames: string[] },
  input: ScheduleInput,
  actor: string,
  keys: WriteKeys,
  auditId: string,
): Promise<ScheduleOutcome> {
  const { hcp, audit, cfg } = deps;
  if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.end <= input.start) throw new WriteRefused("start/end must be HH:MM with end after start");
  const weekday = weekdayOf(input.date);
  if (!cfg.day_shape.production_days.includes(weekday) && input.kind !== "emergency") throw new WriteRefused(`${input.date} is a ${weekday}; production days are ${cfg.day_shape.production_days.join(", ")}. Emergency work may override.`);

  const job = await hcp.job(input.job_id);
  if (!job) throw new WriteRefused(`no job ${input.job_id}`);
  const customer = [job.customer.first, job.customer.last].filter(Boolean).join(" ") || "(no name)";

  // Authorization is the crew rules, re-run here — approval is a gate, not authorization.
  const events = await hcp.events();
  const out = outByDay(absencesFor(events, [input.date], deps.rosterNames))[input.date] ?? [];
  const crew_check = validateCrew({ members: input.crew, tags: job.tags, out }, cfg.roster, cfg.crew_rules, cfg.equipment);
  if (!crew_check.valid) throw new WriteRefused(`crew is not valid for this job: ${crew_check.violations.join("; ")}`);

  const employee_ids = employeeIdsFor(input.crew, await hcp.employees());
  const arrival = arrivalWindowFor(input, cfg.day_shape);
  const hcp_call: ScheduleWrite = {
    job_id: job.id,
    scheduled_start: chicagoIso(input.date, input.start),
    scheduled_end: chicagoIso(input.date, input.end),
    ...(arrival !== null ? { arrival_window_minutes: arrival } : {}),
    employee_ids,
    notify: false, // the customer text is never a schedule side effect
    notify_pro: cfg.write_policy.notify_pro_on_schedule,
  };

  const { fresh, record } = await audit.begin({ id: auditId, kind: "write_schedule", job_id: job.id, actor, ...keys, request: hcp_call });
  if (!fresh && record.status === "done") {
    return { ok: true, replay: true, audit_id: record.id, job_id: job.id, customer, scheduled: scheduled(input, arrival), crew_check, hcp_call, hcp_result: record.result };
  }
  // fresh, or pending/failed from an interrupted attempt: a schedule write is safe to send again.
  try {
    const hcp_result = await hcp.updateJobSchedule(hcp_call);
    await audit.complete(record.id, hcp_result);
    return { ok: true, replay: false, audit_id: record.id, job_id: job.id, customer, scheduled: scheduled(input, arrival), crew_check, hcp_call, hcp_result };
  } catch (err) {
    await audit.fail(record.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function scheduled(input: ScheduleInput, arrival: number | null) {
  return { date: input.date, weekday: weekdayOf(input.date), start: input.start, end: input.end, arrival_window_minutes: arrival, crew: input.crew };
}

export interface NotifyOutcome {
  ok: true;
  replay: boolean;
  audit_id: string;
  job_id: string;
  customer: string;
  hcp_call: ScheduleWrite;
  hcp_result: unknown;
}

export async function notifyCustomer(
  deps: { hcp: HcpSource; audit: WriteAuditStore },
  jobId: string,
  actor: string,
  keys: WriteKeys,
  auditId: string,
): Promise<NotifyOutcome> {
  const job = await deps.hcp.job(jobId);
  if (!job) throw new WriteRefused(`no job ${jobId}`);
  if (!job.start) throw new WriteRefused(`${jobId} is not scheduled; schedule it first, then notify`);
  const customer = [job.customer.first, job.customer.last].filter(Boolean).join(" ") || "(no name)";
  const hcp_call: ScheduleWrite = { job_id: job.id, scheduled_start: job.start, scheduled_end: job.end ?? job.start, notify: true, notify_pro: false };

  const { fresh, record } = await deps.audit.begin({ id: auditId, kind: "notify_customer", job_id: job.id, actor, ...keys, request: hcp_call });
  if (!fresh) {
    if (record.status === "done") return { ok: true, replay: true, audit_id: record.id, job_id: job.id, customer, hcp_call, hcp_result: record.result };
    // pending or failed: the text may or may not have gone out. Never send a second one blind.
    throw new WriteRefused(`a previous notify attempt for ${customer} (${job.invoice ?? job.id}) is unresolved (${record.status}); check HousecallPro before trying again`);
  }
  try {
    const hcp_result = await deps.hcp.updateJobSchedule(hcp_call);
    await deps.audit.complete(record.id, hcp_result);
    return { ok: true, replay: false, audit_id: record.id, job_id: job.id, customer, hcp_call, hcp_result };
  } catch (err) {
    await deps.audit.fail(record.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Recent write history for one job, for the agent to answer "did we already text them?". */
export async function writesFor(audit: WriteAuditStore, jobId: string): Promise<WriteRecord[]> {
  return audit.forJob(jobId);
}
