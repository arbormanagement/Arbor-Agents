import { defineEval } from "eve/evals";

/**
 * A scheduler changes a rule by chatting; the next turn sees the new value.
 * Uses `placeholders` so the roster eval is unaffected by the shared in-memory store.
 */
const newPlaceholders = {
  family: "placeholders",
  value: {
    map: [
      { assignee: "Nic", crew: "Crew A" },
      { assignee: "Justin", crew: "Crew B" },
      { assignee: "Elizabeth", crew: "Crew C" },
      { assignee: "Kim", crew: "Crew D" },
    ],
    real_names_mean_firm: true,
  },
  evidence: "eval: Kim now marks Crew D on the tentative board",
};

export default defineEval({
  description: "config__set supersedes the current record and the next turn recalls the new value.",
  async test(t) {
    const first = await t.send(`fixture:set ${JSON.stringify(newPlaceholders)}`);
    t.calledTool("config__set", { input: { family: "placeholders" }, count: 1 });
    first.messageIncludes("Done:");

    const second = await first.session.send("fixture:echo");
    second.messageIncludes("Crew D");
    second.messageIncludes("config:placeholders");
    t.succeeded();
  },
});
