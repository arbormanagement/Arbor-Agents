import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWriteAudit } from "../lib/audit";

export default defineTool({
  description: "What this agent has written to HousecallPro for one job: schedule writes and customer notifications, newest first, with who did it and when. Use it to answer 'did we already text them?'.",
  inputSchema: z.object({ job_id: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) }),
  async execute({ job_id, limit }) {
    const rows = await (await getWriteAudit()).forJob(job_id, limit);
    return { job_id, count: rows.length, writes: rows.map((r) => ({ id: r.id, kind: r.kind, actor: r.actor, status: r.status, at: r.created_at, completed_at: r.completed_at, error: r.error })) };
  },
});
