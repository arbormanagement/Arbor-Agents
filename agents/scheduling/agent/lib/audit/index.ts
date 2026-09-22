import { getSql } from "../db";
import { InMemoryWriteAudit, PostgresWriteAudit, type WriteAuditStore } from "./store";

let ready: Promise<WriteAuditStore> | null = null;

export function getWriteAudit(): Promise<WriteAuditStore> {
  if (ready) return ready;
  ready = (async () => {
    const sql = await getSql();
    return sql ? PostgresWriteAudit.create(sql) : new InMemoryWriteAudit();
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
