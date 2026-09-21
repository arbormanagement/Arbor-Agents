/**
 * The storage seam for config records, plus the in-memory implementation.
 * The durable implementation is PostgresConfigStore (postgres-store.ts);
 * index.ts picks one. Both honour the same contract:
 *
 * Nothing is deleted. `set` supersedes: the prior record gets `superseded_by`
 * and stays in history, so any rule traces back to who set it and when.
 */
import { createHash, randomUUID } from "node:crypto";
import { FAMILIES, parseFamilyValue, type ConfigRecord, type Family } from "./schema";
import { SEED_SET_BY, seed } from "./seed";

export interface ConfigStore {
  /** The current (non-superseded) record for a family, or null. */
  current(family: Family): Promise<ConfigRecord | null>;
  /** The current record of every family that has one. */
  currentAll(): Promise<ConfigRecord[]>;
  /** Every record for a family, newest first. */
  history(family: Family): Promise<ConfigRecord[]>;
  /**
   * Validate and write a new current record, superseding the prior one. Throws on invalid value.
   * `id` is an optional idempotency key (a UUID): a second call with the same id is a no-op that
   * returns the record already written. Tools derive it from the tool call id, because eve re-runs
   * a tool step that was interrupted before it was recorded.
   */
  set(input: SetInput): Promise<ConfigRecord>;
}

export interface SetInput {
  family: Family;
  value: unknown;
  set_by: string;
  evidence?: string;
  id?: string;
}

/** A stable UUID derived from any string key (SHA-256, formatted as a v8 UUID). */
export function uuidFromKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 32);
  const b = h.slice(0, 8), c = h.slice(8, 12), d = "8" + h.slice(13, 16), e = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), f = h.slice(20, 32);
  return `${b}-${c}-${d}-${e}-${f}`;
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly records: ConfigRecord[] = [];

  async current(family: Family): Promise<ConfigRecord | null> {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (r.family === family && !r.superseded_by) return r;
    }
    return null;
  }

  async currentAll(): Promise<ConfigRecord[]> {
    const out: ConfigRecord[] = [];
    for (const family of FAMILIES) {
      const r = await this.current(family);
      if (r) out.push(r);
    }
    return out;
  }

  async history(family: Family): Promise<ConfigRecord[]> {
    return this.records.filter((r) => r.family === family).reverse();
  }

  async set(input: SetInput): Promise<ConfigRecord> {
    const value = parseFamilyValue(input.family, input.value); // throws ZodError on a malformed value
    if (input.id) {
      const existing = this.records.find((r) => r.id === input.id);
      if (existing) return existing; // idempotent replay
    }
    const record: ConfigRecord = {
      id: input.id ?? randomUUID(),
      family: input.family,
      value,
      set_by: input.set_by,
      set_at: new Date().toISOString(),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    };
    const prior = await this.current(input.family);
    if (prior) prior.superseded_by = record.id;
    this.records.push(record);
    return record;
  }
}

/**
 * Write the seed into an empty store. No-op for families that already have a
 * record. Safe under a race: if two cold instances seed the same family at
 * once, the loser's write fails on the one-current-per-family rule, and the
 * family is re-read rather than reported.
 */
export async function seedIfEmpty(store: ConfigStore): Promise<number> {
  const have = new Set((await store.currentAll()).map((r) => r.family));
  let written = 0;
  for (const family of FAMILIES) {
    if (have.has(family)) continue;
    try {
      await store.set({ family, value: seed[family], set_by: SEED_SET_BY, evidence: "Transcribed from job-scheduling SKILL.md v1.10 on 2026-09-19." });
      written++;
    } catch (err) {
      if (await store.current(family)) continue; // someone else seeded it first
      throw err;
    }
  }
  return written;
}
