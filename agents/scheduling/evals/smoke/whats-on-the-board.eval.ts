import { defineEval } from "eve/evals";

export default defineEval({
  description: "get_board returns the week with placeholder crews decoded and a firm day scored against its target.",
  async test(t) {
    const turn = await t.send(`fixture:tool get_board ${JSON.stringify({ week_start: "2026-09-21" })}`);
    t.calledTool("get_board", { count: 1 });
    turn.messageIncludes('"crew":"Crew A"');
    turn.messageIncludes('"crew":"Aaron, Alex, Luke"');
    turn.messageIncludes('"status":"built"');
    turn.messageIncludes("tentative board");
    t.succeeded();
  },
});
