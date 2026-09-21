import { defineEvalConfig } from "eve/evals";

// The judge is never the agent under test. Deterministic evals (fixture model)
// do not use it; the live judgment evals in evals/live/ do.
export default defineEvalConfig({
  judge: { model: "anthropic/claude-sonnet-5" },
});
