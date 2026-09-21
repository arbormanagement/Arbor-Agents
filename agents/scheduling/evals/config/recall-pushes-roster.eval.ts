import { defineEval } from "eve/evals";

/**
 * The config slot recalls the roster into context on a plain turn — the model
 * did not have to ask for it. Plan §7.1, phase 1 "done when".
 */
export default defineEval({
  description: "Seeded roster is present in context without any tool call.",
  async test(t) {
    await t.send("fixture:echo");
    t.succeeded();
    t.usedNoTools();
    t.messageIncludes("config:roster");
    t.messageIncludes("Ethan");
    t.messageIncludes("config:crew_rules");
  },
});
