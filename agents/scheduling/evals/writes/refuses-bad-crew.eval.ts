import { defineEval } from "eve/evals";

/** Approval is a gate, not authorization: the crew rules run inside the write and refuse before anything reaches HCP. */
export default defineEval({
  description: "write_schedule refuses Ethan + Bob; the tool call fails and nothing is written.",
  async test(t) {
    const input = { job_id: "job_u04", date: "2026-09-28", start: "08:00", end: "10:00", crew: ["Ethan", "Bob", "Luke"], first_job_of_day: true }; // job_u04: no other eval writes it, so its history must stay empty
    const turn = await t.send(`fixture:tool write_schedule ${JSON.stringify(input)}`);
    t.calledTool("write_schedule", { status: "failed", count: 1 });
    turn.messageIncludes("never pair Ethan + Bob");
    const history = await turn.session.send('fixture:tool get_write_history {"job_id":"job_u04"}');
    history.messageIncludes('"count":0');
    t.succeeded();
  },
});
