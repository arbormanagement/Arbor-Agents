/**
 * HCP reads reach the Arbor MCP from CODE, never from the model (plan §5.4):
 * the MCP's four meta-tools take the real tool name inside the arguments, so
 * an allowlist on a model-facing connection could never match anything. This
 * client calls exactly the read tools named in READ_TOOLS and nothing else.
 *
 *   HCP_SOURCE=mcp      live reads; needs ARBOR_MCP_URL + ARBOR_MCP_TOKEN
 *   HCP_SOURCE=fixture  evals/data/hcp/*.json + weather.json; no network
 *
 * Unset: mcp on the production deployment when a token is present, fixture
 * everywhere else — the same posture as CONFIG_STORE.
 *
 * Every query carries a server-side `_query` projection so PII (phones,
 * emails, streets, notes) is dropped before it leaves the MCP.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HcpEmployee, HcpEvent, HcpJob, HcpLineItem, HcpSource, JobsFilter } from "./types";

export const READ_TOOLS = ["housecallpro_get_jobs", "housecallpro_list_events", "housecallpro_get_job_line_items", "housecallpro_list_employees"] as const;
type ReadTool = (typeof READ_TOOLS)[number];

const JOB_PROJECTION =
  "jobs[*].{id: id, invoice: invoice_number, description: description, status: work_status, " +
  "start: schedule.scheduled_start, end: schedule.scheduled_end, arrival: schedule.arrival_window, total: total_amount, " +
  "tags: tags, employees: assigned_employees[*].first_name, employee_ids: assigned_employees[*].id, " +
  "job_type: job_fields.job_type.name, customer: {first: customer.first_name, last: customer.last_name}, " +
  "city: address.city, zip: address.zip, lat: address.latitude, lng: address.longitude, created_at: created_at}";
const EVENT_PROJECTION =
  "events[*].{id: id, name: name, recurrence_rule: recurrence_rule, start: schedule.start_time, end: schedule.end_time, " +
  "all_day: all_day, employees: assigned_employees[*].first_name}";
const LINE_ITEM_PROJECTION = "data[*].{id: id, name: name, kind: kind, amount: amount}";
const EMPLOYEE_PROJECTION = "employees[*].{id: id, first_name: first_name, last_name: last_name, role: role}";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

export type HcpBackend = "mcp" | "fixture";

export function selectedHcpSource(env: NodeJS.ProcessEnv = process.env): HcpBackend {
  const explicit = env.HCP_SOURCE;
  if (explicit === "mcp" || explicit === "fixture") return explicit;
  if (explicit) throw new Error(`HCP_SOURCE=${explicit} is not one of mcp | fixture.`);
  return env.VERCEL_ENV === "production" && env.ARBOR_MCP_TOKEN ? "mcp" : "fixture";
}

// ---------------------------------------------------------------- MCP-backed

interface McpCaller {
  /** Run one named read tool with arguments; returns the parsed JSON result. */
  call(tool: ReadTool, args: Record<string, unknown>): Promise<unknown>;
}

export async function connectArborMcp(opts: { url: string; token: string }): Promise<McpCaller> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
  });
  const client = new Client({ name: "arbor-agents/scheduling", version: "0.2.0" });
  await client.connect(transport);
  return {
    async call(tool, args) {
      if (!READ_TOOLS.includes(tool)) throw new Error(`${tool} is not one of the code-owned read tools`);
      const res = await client.callTool({ name: "execute_tool", arguments: { tool, arguments: args } });
      const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
      const text = content.find((c) => c.type === "text")?.text;
      if (!text) throw new Error(`${tool}: empty MCP result`);
      const parsed = JSON.parse(text) as unknown;
      const meta = (parsed as { _meta?: { error?: string; truncated?: boolean } })._meta;
      if (meta?.error) throw new Error(`${tool}: MCP error ${meta.error}`);
      if (meta?.truncated) throw new Error(`${tool}: MCP result truncated — page smaller or project fewer fields`);
      return parsed;
    },
  };
}

export function mcpSource(mcp: McpCaller): HcpSource {
  async function paged<T>(tool: ReadTool, base: Record<string, unknown>, sizeKey: "page_size" | "per_page"): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = (await mcp.call(tool, { ...base, page, [sizeKey]: PAGE_SIZE })) as T[] | null;
      if (!Array.isArray(rows)) break;
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break; // an empty or short page ends the walk only when nothing is filtered server-side
    }
    return out;
  }
  return {
    jobs: (filter: JobsFilter) => paged<HcpJob>("housecallpro_get_jobs", { ...filter, _query: JOB_PROJECTION }, "page_size"),
    events: () => paged<HcpEvent>("housecallpro_list_events", { _query: EVENT_PROJECTION }, "page_size"),
    lineItems: async (jobId) => (await mcp.call("housecallpro_get_job_line_items", { job_id: jobId, _query: LINE_ITEM_PROJECTION })) as HcpLineItem[],
    employees: () => paged<HcpEmployee>("housecallpro_list_employees", { _query: EMPLOYEE_PROJECTION }, "page_size"),
    precipitation: openMeteo,
  };
}

async function openMeteo(point: { latitude: number; longitude: number }, pastDays: number, forecastDays: number) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "America/Chicago");
  url.searchParams.set("past_days", String(pastDays));
  url.searchParams.set("forecast_days", String(forecastDays));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const body = (await res.json()) as { daily?: { time?: string[]; precipitation_sum?: Array<number | null> } };
  const time = body.daily?.time ?? [];
  const sums = body.daily?.precipitation_sum ?? [];
  return time.map((date, i) => ({ date, inches: sums[i] ?? 0 }));
}

// ------------------------------------------------------------ fixture-backed

export function fixtureSource(dir: string): HcpSource {
  const load = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(dir, name), "utf8")) as T;
  return {
    async jobs(filter) {
      const all = await load<HcpJob[]>("jobs.json");
      return all.filter((j) => {
        if (filter.work_status && !filter.work_status.includes(filterStatus(j.status))) return false;
        if (filter.scheduled_start_min || filter.scheduled_start_max) {
          if (!j.start) return false;
          const day = j.start.slice(0, 10);
          if (filter.scheduled_start_min && day < filter.scheduled_start_min.slice(0, 10)) return false;
          if (filter.scheduled_start_max && day > filter.scheduled_start_max.slice(0, 10)) return false;
        }
        return true;
      });
    },
    events: () => load<HcpEvent[]>("events.json"),
    async lineItems(jobId) {
      const all = await load<Record<string, HcpLineItem[]>>("line_items.json");
      return all[jobId] ?? [];
    },
    employees: () => load<HcpEmployee[]>("employees.json"),
    precipitation: () => load<Array<{ date: string; inches: number }>>("weather.json"),
  };
}

/** HCP's filter vocabulary differs from what jobs report back; map the report to the filter. */
export function filterStatus(reported: string): NonNullable<JobsFilter["work_status"]>[number] {
  const s = reported.toLowerCase();
  if (s.includes("needs scheduling") || s === "unscheduled") return "unscheduled";
  if (s.includes("in progress")) return "in_progress";
  if (s.startsWith("complete")) return "completed";
  if (s.includes("cancel")) return "canceled";
  return "scheduled";
}

/** The fixture world is anchored on one date so evals are stable; live reads use the real day. */
export const FIXTURE_TODAY = "2026-09-21";

export function hcpToday(): string {
  if (process.env.SCHEDULING_TODAY) return process.env.SCHEDULING_TODAY;
  if (selectedHcpSource() === "fixture") return FIXTURE_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** eve compiles modules away from the source tree, so the fixture dir is found from cwd, not import.meta.url. */
function findFixtureDir(): string {
  if (process.env.HCP_FIXTURE_DIR) return process.env.HCP_FIXTURE_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const rel of ["evals/data/hcp", "agents/scheduling/evals/data/hcp"]) {
      const candidate = join(dir, rel);
      if (existsSync(join(candidate, "jobs.json"))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("HCP fixture directory not found; set HCP_FIXTURE_DIR");
}

// ------------------------------------------------------------------ selection

let ready: Promise<HcpSource> | null = null;

export function getHcpSource(): Promise<HcpSource> {
  if (ready) return ready;
  const backend = selectedHcpSource();
  ready = (async () => {
    if (backend === "fixture") {
      const dir = findFixtureDir();
      console.log(`[hcp] source=fixture dir=${dir}`);
      return fixtureSource(dir);
    }
    const url = process.env.ARBOR_MCP_URL ?? "https://arbor-mcp.up.railway.app/mcp";
    const token = process.env.ARBOR_MCP_TOKEN;
    if (!token) throw new Error("HCP_SOURCE=mcp needs ARBOR_MCP_TOKEN.");
    console.log(`[hcp] source=mcp url=${url}`);
    return mcpSource(await connectArborMcp({ url, token }));
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
