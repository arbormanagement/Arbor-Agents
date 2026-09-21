/**
 * configMemory() — the memory provider that pushes the scheduling rules into
 * every turn and gives the model the tools to edit them.
 *
 * Recall returns one message per family with a stable id (`config:<family>`),
 * so the newest version supersedes the earlier copy in context instead of
 * accumulating beside it. That is the "push, not pull" property: the model
 * never has to remember to look the rules up.
 *
 * The provider exposes list / get / history / set. The tools close over the locked scope for the turn (eve's contract), so the
 * model cannot redirect them. Writes validate against the family schema and
 * carry the caller's principal as set_by.
 */
import { defineMemoryProvider } from "eve/memory";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { FAMILIES, familyEnum, type ConfigRecord } from "./schema";
import { uuidFromKey, type ConfigStore } from "./store";

function render(record: ConfigRecord): string {
  const who = record.set_by.startsWith("seed:") ? "seed" : record.set_by;
  return [
    `## config:${record.family}  (set by ${who} at ${record.set_at.slice(0, 10)}${record.evidence ? `; evidence: ${record.evidence}` : ""})`,
    "```json",
    JSON.stringify(record.value),
    "```",
  ].join("\n");
}

function summarize(record: ConfigRecord) {
  return {
    id: record.id,
    family: record.family,
    set_by: record.set_by,
    set_at: record.set_at,
    ...(record.evidence ? { evidence: record.evidence } : {}),
  };
}

export function configMemory(store: ConfigStore) {
  const recall = async () => {
    const records = await store.currentAll();
    return {
      messages: records.map((r) => ({ id: `config:${r.family}`, content: render(r) })),
    };
  };

  return defineMemoryProvider({
    recall: {
      "turn.started": recall,
      "compaction.completed": recall,
    },
    async tools(ctx) {
      const principal = ctx.session.auth.current?.principalId ?? "unknown";
      return {
        list: defineTool({
          description: "List every config family with who set it and when. Use before editing.",
          inputSchema: z.object({}),
          async execute() {
            const records = await store.currentAll();
            return { families: FAMILIES, current: records.map(summarize) };
          },
        }),
        get: defineTool({
          description: "Read the current value of one config family, with its provenance.",
          inputSchema: z.object({ family: familyEnum }),
          async execute({ family }) {
            const r = await store.current(family);
            return r ? { ...summarize(r), value: r.value } : { family, value: null };
          },
        }),
        history: defineTool({
          description:
            "Who changed one config family and when, newest first. Each entry carries set_by, set_at, " +
            "evidence, the value at that time, and superseded_by (null for the current record).",
          inputSchema: z.object({ family: familyEnum, limit: z.number().int().min(1).max(50).default(10) }),
          async execute({ family, limit }) {
            const rows = await store.history(family);
            return {
              family,
              count: rows.length,
              entries: rows.slice(0, limit).map((r) => ({ ...summarize(r), superseded_by: r.superseded_by ?? null, value: r.value })),
            };
          },
        }),
        set: defineTool({
          description:
            "Replace the current value of one config family with a complete new value. " +
            "Read it first with get, change only what the person asked, and pass the whole value back. " +
            "The value is validated against the family's schema; unknown fields are rejected. " +
            "Always pass evidence: what the person said, in their words.",
          inputSchema: z.object({
            family: familyEnum,
            value: z.unknown(),
            evidence: z.string().min(1).optional(),
          }),
          async execute({ family, value, evidence }, call) {
            // The record id is derived from session + turn + tool call id: if eve
            // re-runs this step after an interruption, the second write is a no-op.
            // (Call ids alone are not unique across sessions — the eval fixture's
            // collide — so the key carries the session and turn as well.)
            const id = uuidFromKey(`config__set:${call.session.id}:${call.session.turn.id}:${call.callId}`);
            const record = await store.set({ id, family, value, set_by: principal, ...(evidence ? { evidence } : {}) });
            return { ok: true, ...summarize(record) };
          },
        }),
      };
    },
  });
}
