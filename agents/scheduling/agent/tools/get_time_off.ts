import { defineTool } from "eve/tools";
import { z } from "zod";
import { configValue } from "../lib/config/read";
import { getHcpSource } from "../lib/hcp/source";
import { spend } from "../lib/scheduling/budget";
import { weekDays } from "../lib/scheduling/dates";
import { absencesFor, outByDay } from "../lib/scheduling/time-off";

export default defineTool({
  description:
    "Who is OFF each day of a week, from HousecallPro calendar events with recurrence expanded (a multi-day absence is one event plus a rule — this walks every page and expands it). " +
    "Run this before building any crew. week_start is the Monday, YYYY-MM-DD.",
  inputSchema: z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  async execute({ week_start }) {
    spend("time_off");
    const [hcp, roster] = await Promise.all([getHcpSource(), configValue("roster")]);
    const events = await hcp.events();
    const days = weekDays(week_start);
    const absences = absencesFor(events, days, roster.people.map((p) => p.name));
    return {
      week_start,
      events_scanned: events.length,
      out_by_day: outByDay(absences),
      absences,
      note: "Match is on the assigned employee; '*' means the company is closed that day. Print this per-day roster back and let the office correct it before crews are built.",
    };
  },
});
