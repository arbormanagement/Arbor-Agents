import { defineEval } from "eve/evals";

export default defineEval({
  description: "A 3-man crew with one CDL driver is a violation.",
  async test(t) {
    const turn = await t.send(`fixture:tool validate_crew ${JSON.stringify({ members: ["Bob", "James", "Aaron"], tags: [] })}`);
    turn.messageIncludes('"valid":false');
    turn.messageIncludes("2 CDL drivers (have 1)");
    t.succeeded();
  },
});
