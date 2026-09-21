/** Typed read of a config family's current value for tools. Throws if the family has no record (the seed guarantees one). */
import { lazyConfigStore } from "./index";
import { parseFamilyValue, type Family, type FamilyValue } from "./schema";

export async function configValue<F extends Family>(family: F): Promise<FamilyValue<F>> {
  const r = await lazyConfigStore.current(family);
  if (!r) throw new Error(`config family ${family} has no current record`);
  return parseFamilyValue(family, r.value);
}
