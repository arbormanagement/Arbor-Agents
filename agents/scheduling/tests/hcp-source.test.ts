import assert from "node:assert/strict";
import { test } from "node:test";
import { McpTruncated, mcpSource, parseMcpResult } from "../agent/lib/hcp/source";

test("parseMcpResult: a bare array or object passes through", () => {
  assert.deepEqual(parseMcpResult("t", "[1,2]"), [1, 2]);
  assert.deepEqual(parseMcpResult("t", '{"id":"job_1"}'), { id: "job_1" });
  assert.equal(parseMcpResult("t", "null"), null);
});

test("parseMcpResult: a _meta warning wraps the payload as { _meta, data } — unwrap it", () => {
  // Live shape on 2026-09-22: every unscheduled job has null start/end, so the
  // MCP flags all_null_projection_keys and wraps the rows. Treating the wrapper
  // as "not an array" returned an empty backlog.
  const text = JSON.stringify({ _meta: { warning: "all_null_projection_keys", keys: ["start", "end"] }, data: [{ id: "job_1" }, { id: "job_2" }] });
  assert.deepEqual(parseMcpResult("housecallpro_get_jobs", text), [{ id: "job_1" }, { id: "job_2" }]);
});

test("parseMcpResult: truncated → McpTruncated; error → Error; empty → Error", () => {
  assert.throws(() => parseMcpResult("t", JSON.stringify({ _meta: { truncated: true, returned: 66, total: 91 }, data: [] })), McpTruncated);
  assert.throws(() => parseMcpResult("t", JSON.stringify({ _meta: { error: "invalid_query" } })), /MCP error invalid_query/);
  assert.throws(() => parseMcpResult("t", undefined), /empty MCP result/);
});

test("paged walk halves the page size on truncation and restarts from page 1", async () => {
  const calls: Array<{ page: number; page_size: number }> = [];
  const all = Array.from({ length: 91 }, (_, i) => ({ id: `job_${i}` }));
  const fake = {
    async call(tool: string, args: Record<string, unknown>) {
      assert.equal(tool, "housecallpro_get_jobs");
      const page = args.page as number;
      const size = args.page_size as number;
      calls.push({ page, page_size: size });
      if (size > 25) throw new McpTruncated(tool); // "66 of 91 fit"
      return all.slice((page - 1) * size, page * size);
    },
  };
  const jobs = await mcpSource(fake as never).jobs({ work_status: ["unscheduled"] });
  assert.equal(jobs.length, 91);
  assert.deepEqual(new Set(jobs.map((j) => j.id)).size, 91, "no duplicates across the restart");
  assert.deepEqual(calls.map((c) => c.page_size).slice(0, 2), [50, 25], "starts at the jobs page size, halves once");
  assert.deepEqual(calls.filter((c) => c.page_size === 25).map((c) => c.page), [1, 2, 3, 4], "restarts from page 1 at the new size");
});

test("paged walk gives up below the minimum page size", async () => {
  const fake = { async call(tool: string) { throw new McpTruncated(tool); } };
  await assert.rejects(mcpSource(fake as never).events(), McpTruncated);
});

test("job(): an HCP 404 is null, any other tool error propagates", async () => {
  const { McpToolError } = await import("../agent/lib/hcp/source");
  const fake = {
    async call(tool: string, args: Record<string, unknown>) {
      if (args.id === "job_nope") throw new McpToolError(tool, 'Error: HousecallPro API error: 404 Not Found — {"error":"Job not found"}');
      if (args.id === "job_refused") throw new McpToolError(tool, "Refused: 'housecallpro_get_job' is outside this service token's scopes (…)");
      return { id: args.id };
    },
  };
  const src = mcpSource(fake as never);
  assert.equal(await src.job("job_nope"), null);
  assert.deepEqual(await src.job("job_1"), { id: "job_1" });
  await assert.rejects(src.job("job_refused"), /outside this service token's scopes/);
});
