import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import type { HcpLineItem } from "../lib/hcp/types";
import { getHcpSource, hcpToday } from "../lib/hcp/source";
import { buildBacklog } from "../lib/scheduling/backlog";
import { spend } from "../lib/scheduling/budget";
import { addDays } from "../lib/scheduling/dates";

const TRAILING_WEEKS = 10;

export default defineTool({
  description:
    "The schedulable backlog for a target week: unscheduled jobs plus Sunday-parked and priority-tagged ones, with hard blocks removed and listed, each job priced on its TREE-ONLY amount (stump line items netted out), placed in a capacity pool, aged, and marked band A (past its pool's lead-time window) or B. " +
    "Pass unlocked_tags from get_ground_state so wet-blocked work is dropped. week_start is the Monday being built.",
  inputSchema: z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    unlocked_tags: z.array(z.string()).optional(),
  }),
  async execute({ week_start, unlocked_tags }) {
    spend("backlog");
    const [hcp, hard_blocks, tiers, equipment] = await Promise.all([getHcpSource(), configValue("hard_blocks"), configValue("tiers"), configValue("equipment")]);
    const now = hcpToday();
    const [unscheduled, scheduled, completed] = await Promise.all([
      hcp.jobs({ work_status: ["unscheduled"] }),
      hcp.jobs({ work_status: ["scheduled"], scheduled_start_min: addDays(week_start, -14), scheduled_start_max: addDays(week_start, 41) }),
      hcp.jobs({ work_status: ["completed"], scheduled_start_min: addDays(now, -7 * TRAILING_WEEKS), scheduled_start_max: now }),
    ]);
    // Line items only where stump work may be bundled — one call per such job, not per job.
    const lineItems: Record<string, HcpLineItem[]> = {};
    const bundled = [...unscheduled, ...scheduled].filter((j) => j.tags.some((t) => /stump/i.test(t)) && !/-\d$/.test(j.invoice ?? ""));
    await Promise.all(bundled.slice(0, 40).map(async (j) => (lineItems[j.id] = await hcp.lineItems(j.id))));
    const result = buildBacklog(
      { today: now, unscheduled, scheduled, completed, trailingWeeks: TRAILING_WEEKS, lineItems, unlockedTags: unlocked_tags ?? null },
      { hard_blocks, tiers, equipment },
    );
    return {
      ...result,
      counts: { candidates: result.candidates.length, blocked: result.blocked.length, unscheduled_read: unscheduled.length, completed_read: completed.length },
    };
  },
});
