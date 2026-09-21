import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { checkEquipment } from "../lib/scheduling/equipment";

export default defineTool({
  description:
    "Equipment contention for one day's jobs from their tags: which pools are claimed, and where claims exceed the count. Only the single-point pools (crane, Cat, Serco, Giant 2700) can really collide.",
  inputSchema: z.object({ jobs: z.array(z.object({ id: z.string(), tags: z.array(z.string()) })).min(1) }),
  async execute({ jobs }) {
    const equipment = await configValue("equipment");
    return checkEquipment(jobs, equipment);
  },
});
