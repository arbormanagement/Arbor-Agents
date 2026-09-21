import { defineEval } from "eve/evals";

/**
 * The audit trail survives an edit: after one change, history holds the seed,
 * now superseded, and the new current record — and says so.
 *
 * Uses `known_one_day`, a family no other eval touches: the store is shared
 * across evals in one process, so a family another eval edits would not have
 * a predictable history length.
 *
 * Under CONFIG_STORE=pglite this exercises the real table, the partial unique
 * index, the deferred self-referencing key and the supersede transaction on a
 * Postgres engine.
 */
export default defineEval({
  description: "config__history shows the seed superseded by the office's edit.",
  async test(t) {
    const edit = {
      family: "known_one_day",
      value: { jobs: [{ invoice: "4521", customer: "Hendricks", note: "eval: two stumps, half day" }] },
      evidence: "eval: Elizabeth says 4521 is a one-day job",
    };
    const first = await t.send(`fixture:set ${JSON.stringify(edit)}`);
    t.calledTool("config__set", { input: { family: "known_one_day" }, count: 1 });

    const second = await first.session.send("fixture:history known_one_day");
    t.calledTool("config__history", { input: { family: "known_one_day" }, count: 1 });
    second.messageIncludes('"count":2');
    second.messageIncludes("seed:job-scheduling@1.10"); // the seed is still in history …
    second.messageIncludes("Elizabeth says 4521"); // … and the edit is the newest entry
    t.succeeded();
  },
});
