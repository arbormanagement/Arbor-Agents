import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { routeDay } from "../lib/scheduling/routing";

export default defineTool({
  description:
    "Measure a crew-day's route yard → stops → yard: best stop order, road miles (straight-line × road factor) and drive minutes. Use job lat/lng from get_backlog or get_board. Never reason from ZIP codes; measure.",
  inputSchema: z.object({ stops: z.array(z.object({ id: z.string(), lat: z.number(), lng: z.number() })).min(1).max(12) }),
  async execute({ stops }) {
    const yard = await configValue("yard");
    return routeDay(stops, yard);
  },
});
