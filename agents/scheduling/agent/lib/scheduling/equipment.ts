/** Step 6 — single-point equipment contention across one day's jobs. */
import type { FamilyValue } from "../config/schema";

export interface EquipmentClaim {
  pool: string;
  count: number;
  single_point: boolean;
  jobs: string[];
  conflict: boolean;
  note?: string;
}

export function checkEquipment(jobs: Array<{ id: string; tags: string[] }>, equipment: FamilyValue<"equipment">): { claims: EquipmentClaim[]; conflicts: EquipmentClaim[] } {
  const claims: EquipmentClaim[] = [];
  for (const pool of equipment.pools) {
    const claimants = jobs.filter((j) => j.tags.some((t) => matchesPool(t, pool.tags)) && !j.tags.some((t) => /^optional/i.test(t) && matchesPool(t.replace(/^optional\s*/i, ""), pool.tags)));
    if (claimants.length === 0) continue;
    const conflict = claimants.length > pool.count;
    claims.push({
      pool: pool.pool, count: pool.count, single_point: pool.single_point, jobs: claimants.map((j) => j.id), conflict,
      ...(conflict && pool.rental ? { note: `${pool.rental.item} can be rented from ${pool.rental.from} — an action to book, not an assumption` } : {}),
    });
  }
  return { claims, conflicts: claims.filter((c) => c.conflict) };
}

/** A tag like "Dino / Any Forwarding Machine" claims every pool named in it. */
function matchesPool(tag: string, poolTags: string[]): boolean {
  const parts = tag.split("/").map((s) => s.trim().toLowerCase());
  return poolTags.some((pt) => parts.includes(pt.toLowerCase()));
}
