import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { validateCrew } from "../lib/scheduling/crews";

export default defineTool({
  description:
    "Check a proposed crew against every hard rule (never-pair, leader, CDL counts, crane operator, complex rigging, climbing, lift) for a job's tags, plus soft warnings. " +
    "Pass `out` — the names off that day from get_time_off — so an absent member is a violation. A crew with any violation must not be proposed.",
  inputSchema: z.object({
    members: z.array(z.string().min(1)).min(1),
    tags: z.array(z.string()).default([]),
    out: z.array(z.string()).optional(),
  }),
  async execute(input) {
    const [roster, rules, equipment] = await Promise.all([configValue("roster"), configValue("crew_rules"), configValue("equipment")]);
    return validateCrew(input, roster, rules, equipment);
  },
});
