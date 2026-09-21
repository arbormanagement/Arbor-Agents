import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { getHcpSource, hcpToday } from "../lib/hcp/source";
import { spend } from "../lib/scheduling/budget";
import { groundState } from "../lib/scheduling/ground";

export default defineTool({
  description:
    "Ground conditions from Open-Meteo: the last rain event, dry days since, the dryness tier and which dryness tags it unlocks, plus rain in the forecast. " +
    "If the event was SEVERE the result says ask=true: no tier applies and the office decides — use ask_question, do not assume the standard table.",
  inputSchema: z.object({}),
  async execute() {
    spend("ground");
    const [hcp, dryness] = await Promise.all([getHcpSource(), configValue("dryness")]);
    const daily = await hcp.precipitation(dryness.weather_point, dryness.past_days, dryness.forecast_days);
    return groundState(daily, hcpToday(), dryness);
  },
});
