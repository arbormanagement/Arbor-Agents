import { defineEval } from "eve/evals";

/**
 * The customer text is a separate, explicit tool. Scheduling never sends it;
 * notify_customer sends it once for a scheduled job, and a job that is not
 * scheduled is refused. (The live-model version of "the model does not call
 * notify_customer unless asked" lands with the gateway credential.)
 */
export default defineEval({
  description: "notify_customer is the only path to notify:true, refuses an unscheduled job, and records who sent it.",
  async test(t) {
    const refused = await t.send('fixture:tool notify_customer {"job_id":"job_u02"}');
    t.calledTool("notify_customer", { status: "failed", count: 1 });
    refused.messageIncludes("not scheduled");

    const sent = await refused.session.send('fixture:tool notify_customer {"job_id":"job_b04"}');
    sent.messageIncludes('"ok":true');
    sent.messageIncludes('"notify":true');

    const history = await sent.session.send('fixture:tool get_write_history {"job_id":"job_b04"}');
    history.messageIncludes('"kind":"notify_customer"');
    history.messageIncludes('"actor":"local-dev"');
    t.succeeded();
  },
});
