import { defineEval } from "eve/evals";

export default defineEval({
  description: "A crane-tagged job with no Ethan/Adam is a violation; with an operator and three CDLs it is valid.",
  async test(t) {
    const bad = await t.send(`fixture:tool validate_crew ${JSON.stringify({ members: ["Alex", "Luke", "Ian"], tags: ["Treezilla"] })}`);
    bad.messageIncludes('"crane_job":true');
    bad.messageIncludes("needs an operator");
    const good = await bad.session.send(`fixture:tool validate_crew ${JSON.stringify({ members: ["Adam", "Nathan", "Ian"], tags: ["Treezilla"] })}`);
    good.messageIncludes('"valid":true');
    t.calledTool("validate_crew", { count: 2 });
    t.succeeded();
  },
});
