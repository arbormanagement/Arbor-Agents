/**
 * The storage seam for config records. Phase 1 ships the in-memory store
 * (process-local — fine for `eve dev` and evals, NOT durable on Vercel).
 * Phase 1's durable target is Neon; it implements this same interface.
 *
 * Nothing is deleted. `set` supersedes: the prior record gets `superseded_by`
 * and stays in history, so any rule traces back to who set it and when.
 */
import { randomUUID } from "node:crypto";
import { FAMILIES, parseFamilyValue, type ConfigRecord, type Family } from "./schema";
import { SEED_SET_BY, seed } from "./seed";

export interface ConfigStore {
  /** The current (non-superseded) record for a family, or null. */
  current(family: Family): Promise<ConfigRecord | null>;
  /** The current record of every family that has one. */
  currentAll(): Promise<ConfigRecord[]>;
  /** Every record for a family, newest first. */
  history(family: Family): Promise<ConfigRecord[]>;
  /** Validate and write a new current record, superseding the prior one. Throws on invalid value. */
  set(input: { family: Family; value: unknown; set_by: string; evidence?: string }): Promise<ConfigRecord>;
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

  async set(input: { family: Family; value: unknown; set_by: string; evidence?: string }): Promise<ConfigRecord> {
    const value = parseFamilyValue(input.family, input.value); // throws ZodError on a malformed value
    const record: ConfigRecord = {
      id: randomUUID(),
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

/** Write the seed into an empty store. No-op for families that already have a record. */
export async function seedIfEmpty(store: ConfigStore): Promise<number> {
  let written = 0;
  for (const family of FAMILIES) {
    if (await store.current(family)) continue;
    await store.set({ family, value: seed[family], set_by: SEED_SET_BY, evidence: "Transcribed from job-scheduling SKILL.md v1.10 on 2026-09-19." });
    written++;
  }
  return written;
}
