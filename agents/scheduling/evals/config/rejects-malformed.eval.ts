import { defineEval } from "eve/evals";

/**
 * A malformed value fails at write time — it never becomes a rule.
 * `roster` with an unknown key is rejected by the strict schema; the seeded
 * roster is still what the next turn recalls.
 */
export default defineEval({
  description: "config__set rejects a value that does not match the family schema.",
  async test(t) {
    const bad = { family: "roster", value: { people: [], ignore_cdl_requirement: true }, evidence: "eval" };
    const first = await t.send(`fixture:set ${JSON.stringify(bad)}`);
    t.calledTool("config__set", { status: "failed", count: 1 });

    const second = await first.session.send("fixture:echo");
    second.messageIncludes("Ethan"); // the seed survived
    t.succeeded();
  },
});
