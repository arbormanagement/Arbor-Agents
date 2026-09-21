import { defineEval } from "eve/evals";

/**
 * Luke's six-day series starts 9/24 and runs into the target week; a naive
 * start_time filter would report nobody off Monday. The tool expands it.
 */
export default defineEval({
  description: "get_time_off expands recurrence rules and reports a series that began before the week.",
  async test(t) {
    const turn = await t.send(`fixture:tool get_time_off ${JSON.stringify({ week_start: "2026-09-28" })}`);
    t.calledTool("get_time_off", { input: { week_start: "2026-09-28" }, count: 1 });
    turn.messageIncludes('"2026-09-28":["James","Luke"]');
    turn.messageIncludes('"2026-09-30":["Ethan"]');
    turn.messageIncludes('"from_rule":true');
    t.succeeded();
  },
});
