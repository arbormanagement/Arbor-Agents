import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWriteAudit } from "../lib/audit";
import { newWriteId } from "../lib/audit/store";
import { requirePerson } from "../lib/auth/people";
import { configValue } from "../lib/config/read";
import { getHcpSource } from "../lib/hcp/source";
import { personOnlyPolicy } from "../lib/writes/policy";
import { scheduleJob } from "../lib/writes/schedule";

export default defineTool({
  availableInSubagents: false,
  approval: personOnlyPolicy,
  description:
    "THE schedule write: put one job on the HousecallPro board for a date, time block and crew, in one call (schedules AND dispatches). " +
    "Only after the office has approved the proposed week. The crew is re-validated against every hard rule and that day's time off, and refused if invalid. " +
    "The customer is NEVER notified by this tool; use notify_customer only when the office explicitly asks for the customer to be told. " +
    "Times are Chicago local HH:MM. kind: standard | phc | emergency (emergency may fall outside production days).",
  inputSchema: z.object({
    job_id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    crew: z.array(z.string().min(1)).min(1).max(5),
    first_job_of_day: z.boolean(),
    kind: z.enum(["standard", "phc", "emergency"]).default("standard"),
  }),
  async execute(input, ctx) {
    const actor = requirePerson(ctx.session.auth.current).id;
    const keys = { session_id: ctx.session.id, turn_id: ctx.session.turn.id, call_id: ctx.callId };
    const auditId = newWriteId(`write_schedule:${keys.session_id}:${keys.turn_id}:${keys.call_id}`);
    const [hcp, audit, roster, crew_rules, equipment, day_shape, write_policy] = await Promise.all([
      getHcpSource(), getWriteAudit(), configValue("roster"), configValue("crew_rules"), configValue("equipment"), configValue("day_shape"), configValue("write_policy"),
    ]);
    return scheduleJob(
      { hcp, audit, cfg: { roster, crew_rules, equipment, day_shape, write_policy }, rosterNames: roster.people.map((p) => p.name) },
      input, actor, keys, auditId,
    );
  },
});
