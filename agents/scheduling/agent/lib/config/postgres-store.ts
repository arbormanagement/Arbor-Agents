/**
 * PostgresConfigStore — the durable ConfigStore. One table, append-only.
 *
 * Invariants live in the database, not in prose:
 *   - exactly one current record per family: a partial UNIQUE index on
 *     (family) WHERE superseded_by IS NULL. Two writers racing on the same
 *     family cannot both win; the loser's write fails and is reported.
 *   - supersede is atomic: the UPDATE of the prior record and the INSERT of
 *     the new one run in one transaction. The UPDATE has to come first (the
 *     partial index forbids two current rows), so the self-referencing
 *     foreign key is DEFERRABLE INITIALLY DEFERRED and is checked at commit.
 *     PGlite caught this on the first run; a non-deferrable key rejects the
 *     UPDATE because the new id does not exist yet.
 *   - nothing is ever deleted; `history` is the audit trail.
 *   - a write is idempotent on its id, so a re-run tool step cannot write twice.
 *
 * The schema is created on first use with IF NOT EXISTS statements, so a
 * fresh database needs no migration step and a redeploy is a no-op.
 */
import { randomUUID } from "node:crypto";
import { configRecordSchema, parseFamilyValue, type ConfigRecord, type Family } from "./schema";
import type { SqlExecutor, SqlRow } from "./sql";
import type { ConfigStore, SetInput } from "./store";

const TABLE = "scheduling.config_records";

const SCHEMA_STATEMENTS = [
  `CREATE SCHEMA IF NOT EXISTS scheduling`,
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
     seq           bigserial PRIMARY KEY,
     id            uuid NOT NULL UNIQUE,
     family        text NOT NULL,
     value         jsonb NOT NULL,
     set_by        text NOT NULL,
     set_at        timestamptz NOT NULL DEFAULT now(),
     evidence      text,
     superseded_by uuid REFERENCES ${TABLE}(id) DEFERRABLE INITIALLY DEFERRED
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS config_records_one_current_per_family
     ON ${TABLE} (family) WHERE superseded_by IS NULL`,
  `CREATE INDEX IF NOT EXISTS config_records_family_seq ON ${TABLE} (family, seq DESC)`,
];

// to_json(timestamptz) renders ISO 8601 identically on every driver; ::text does not.
const COLUMNS = `id::text AS id, family, value, set_by, to_json(set_at)#>>'{}' AS set_at, evidence, superseded_by::text AS superseded_by`;

function rowToRecord(row: SqlRow): ConfigRecord {
  const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return configRecordSchema.parse({
    id: row.id,
    family: row.family,
    value,
    set_by: row.set_by,
    set_at: row.set_at,
    ...(row.evidence != null ? { evidence: row.evidence } : {}),
    ...(row.superseded_by != null ? { superseded_by: row.superseded_by } : {}),
  });
}

export class PostgresConfigStore implements ConfigStore {
  private constructor(private readonly sql: SqlExecutor) {}

  /** Connect and make sure the schema exists. */
  static async create(sql: SqlExecutor): Promise<PostgresConfigStore> {
    await sql.transaction(SCHEMA_STATEMENTS.map((text) => ({ text })));
    return new PostgresConfigStore(sql);
  }

  async current(family: Family): Promise<ConfigRecord | null> {
    const rows = await this.sql.query(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE family = $1 AND superseded_by IS NULL LIMIT 1`,
      [family],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async currentAll(): Promise<ConfigRecord[]> {
    const rows = await this.sql.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE superseded_by IS NULL ORDER BY family`);
    return rows.map(rowToRecord);
  }

  async history(family: Family): Promise<ConfigRecord[]> {
    const rows = await this.sql.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE family = $1 ORDER BY seq DESC`, [family]);
    return rows.map(rowToRecord);
  }

  async set(input: SetInput): Promise<ConfigRecord> {
    const value = parseFamilyValue(input.family, input.value); // throws ZodError on a malformed value
    const id = input.id ?? randomUUID();
    const set_at = new Date().toISOString();
    // Replay-safe: on a re-run with the same id the UPDATE matches nothing
    // (the prior row is already superseded by this id, and the new row is
    // excluded by id <> $1) and the INSERT hits ON CONFLICT DO NOTHING.
    await this.sql.transaction([
      {
        text: `UPDATE ${TABLE} SET superseded_by = $1::uuid
                WHERE family = $2 AND superseded_by IS NULL AND id <> $1::uuid`,
        params: [id, input.family],
      },
      {
        text: `INSERT INTO ${TABLE} (id, family, value, set_by, set_at, evidence)
               VALUES ($1::uuid, $2, $3::jsonb, $4, $5::timestamptz, $6)
               ON CONFLICT (id) DO NOTHING`,
        params: [id, input.family, JSON.stringify(value), input.set_by, set_at, input.evidence ?? null],
      },
    ]);
    const rows = await this.sql.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE id = $1::uuid`, [id]);
    if (!rows[0]) throw new Error(`config record ${id} was not written`);
    return rowToRecord(rows[0]);
  }
}
