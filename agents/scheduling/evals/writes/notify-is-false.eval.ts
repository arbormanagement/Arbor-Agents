import { defineEval } from "eve/evals";

/** Every write_schedule call reaches HCP with notify:false. It is not an input; the tool echoes the exact call. */
export default defineEval({
  description: "write_schedule puts a job on the board with the customer text hard-coded off.",
  async test(t) {
    const input = { job_id: "job_u01", date: "2026-09-28", start: "08:00", end: "10:00", crew: ["Alex", "Ian", "Aaron"], first_job_of_day: true, kind: "standard" };
    const turn = await t.send(`fixture:tool write_schedule ${JSON.stringify(input)}`);
    t.calledTool("write_schedule", { input: { job_id: "job_u01" }, count: 1 });
    turn.messageIncludes('"ok":true');
    turn.messageIncludes('"notify":false');
    turn.messageIncludes('"scheduled_start":"2026-09-28T08:00:00-05:00"');
    turn.messageIncludes('"employee_ids":["pro_alex","pro_ian","pro_aaron"]');
    t.succeeded();
  },
});
