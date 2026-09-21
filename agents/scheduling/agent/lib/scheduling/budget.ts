/**
 * Per-session call caps on the expensive reads. get_time_off walks every
 * event page and get_backlog fetches line items; a model that loops on them
 * is a cost bug, and the cap turns it into a visible error instead.
 */
import { defineState } from "eve/context";

export const readBudget = defineState("scheduling.read-budget", () => ({ time_off: 0, backlog: 0, board: 0, ground: 0 }));
const CAPS = { time_off: 4, backlog: 4, board: 8, ground: 4 } as const;

export function spend(kind: keyof typeof CAPS): void {
  const { [kind]: used } = readBudget.get();
  if (used >= CAPS[kind]) throw new Error(`${kind} has been read ${used} times this session (cap ${CAPS[kind]}). Reuse the earlier result; start a new session if the week has changed.`);
  readBudget.update((s) => ({ ...s, [kind]: s[kind] + 1 }));
}
