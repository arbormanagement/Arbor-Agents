import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWriteAudit } from "../lib/audit";
import { newWriteId } from "../lib/audit/store";
import { requirePerson } from "../lib/auth/people";
import { getHcpSource } from "../lib/hcp/source";
import { personOnlyPolicy } from "../lib/writes/policy";
import { notifyCustomer } from "../lib/writes/schedule";

export default defineTool({
  availableInSubagents: false,
  approval: personOnlyPolicy,
  description:
    "Send the customer HousecallPro's schedule text for one already-scheduled job. This is the one irreversible action: call it ONLY when the office explicitly asks for that customer to be notified — never as part of scheduling, never inferred. " +
    "A second call for the same job in the same turn is a no-op; an unresolved earlier attempt is refused rather than re-sent.",
  inputSchema: z.object({ job_id: z.string().min(1) }),
  async execute({ job_id }, ctx) {
    const actor = requirePerson(ctx.session.auth.current).id;
    const keys = { session_id: ctx.session.id, turn_id: ctx.session.turn.id, call_id: ctx.callId };
    const auditId = newWriteId(`notify_customer:${keys.session_id}:${keys.turn_id}:${keys.call_id}`);
    const [hcp, audit] = await Promise.all([getHcpSource(), getWriteAudit()]);
    return notifyCustomer({ hcp, audit }, job_id, actor, keys, auditId);
  },
});
