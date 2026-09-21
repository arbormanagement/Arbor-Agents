import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { getHcpSource } from "../lib/hcp/source";
import { buildBoard } from "../lib/scheduling/board";
import { spend } from "../lib/scheduling/budget";
import { addDays } from "../lib/scheduling/dates";

export default defineTool({
  description:
    "The current HousecallPro board for a week: per day, per crew, the jobs in order with blocks and dollars against the crew-day target. " +
    "Placeholder assignees (Nic / Justin / Elizabeth) are crew labels on a tentative board — fully crewed, not empty. week_start is the Monday.",
  inputSchema: z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  async execute({ week_start }) {
    spend("board");
    const [hcp, placeholders, dollar_targets] = await Promise.all([getHcpSource(), configValue("placeholders"), configValue("dollar_targets")]);
    const jobs = await hcp.jobs({ work_status: ["scheduled", "in_progress"], scheduled_start_min: week_start, scheduled_start_max: addDays(week_start, 6) });
    return buildBoard(jobs, week_start, { placeholders, dollar_targets });
  },
});
