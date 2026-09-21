import { defineEval } from "eve/evals";

/**
 * The first three steps of the method, chained the way the skill orders them:
 * ground → unlocked tags → backlog with wet work dropped, stump netted, hard
 * blocks named, pools windowed. This is the eval that proves the reads wire up.
 */
export default defineEval({
  description: "get_ground_state then get_backlog on the fixture week: tier applied, blocks listed, stump netted, bands set.",
  async test(t) {
    const ground = await t.send("fixture:tool get_ground_state {}");
    ground.messageIncludes('"tier":"dry"');
    ground.messageIncludes('"ask":false');

    const backlog = await ground.session.send(
      `fixture:tool get_backlog ${JSON.stringify({ week_start: "2026-09-28", unlocked_tags: ["Wet weather work", "Possible wet weather", "Needs To Be Kinda Dry", "Dryish", "Needs To Be Dry"] })}`,
    );
    t.calledTool("get_backlog", { count: 1 });
    backlog.messageIncludes("ON HOLD: not schedulable");
    backlog.messageIncludes("Ameren");
    backlog.messageIncludes("too wet for tag: Needs To Be Very Dry");
    backlog.messageIncludes('"tree_only":8623');
    backlog.messageIncludes('"source":"sunday_parked"');
    backlog.messageIncludes('"pool":"Crane"');
    backlog.messageIncludes('"band":"A"');
    t.succeeded();
  },
});
