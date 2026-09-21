import { defineEval } from "eve/evals";

/** The one zero-exception pairing rule, validated across 444 real jobs, is a gate in code. */
export default defineEval({
  description: "validate_crew reports Ethan + Bob as a violation and marks the crew invalid.",
  async test(t) {
    const turn = await t.send(`fixture:tool validate_crew ${JSON.stringify({ members: ["Ethan", "Bob", "Luke"], tags: [] })}`);
    t.calledTool("validate_crew", { input: { members: ["Ethan", "Bob", "Luke"] }, count: 1 });
    turn.messageIncludes('"valid":false');
    turn.messageIncludes("never pair Ethan + Bob");
    t.succeeded();
  },
});
