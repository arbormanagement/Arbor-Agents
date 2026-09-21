import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { sizeJob } from "../lib/scheduling/sizing";

export default defineTool({
  description:
    "Size a job into a time block from its TREE-ONLY price (dollars) and crew size, with the crane / land-clearing / PHC / emergency adjustments and duration-hint tags. " +
    "ask=true means the price is above the full-day rung: print the implied crew-hours and ask the office whether it is one day or more — never split or assume.",
  inputSchema: z.object({
    tree_only_price: z.number().nonnegative(),
    crew_size: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    tags: z.array(z.string()).default([]),
    job_type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
  async execute(input) {
    const sizing = await configValue("sizing");
    return sizeJob(input, sizing);
  },
});
