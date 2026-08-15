import type { BuffUpdateState } from "$lib/api";
import type { BuffCategoryKey } from "$lib/config/buff-name-table";

/**
 * Selects the newest active snapshot Buff for each configured category.
 *
 * The reverse index is built once from the settings-driven column projection;
 * each teammate only scans Buffs present in its own snapshot instead of the
 * complete catalog for every category cell.
 */
export function latestBuffsByCategory(
  buffMap: Map<number, BuffUpdateState>,
  categoryKeysByBuffId: Map<number, BuffCategoryKey[]>,
): Map<BuffCategoryKey, BuffUpdateState> {
  const latestByCategory = new Map<BuffCategoryKey, BuffUpdateState>();
  for (const buff of buffMap.values()) {
    for (const categoryKey of categoryKeysByBuffId.get(buff.baseId) ?? []) {
      const current = latestByCategory.get(categoryKey);
      if (!current || buff.createTimeMs >= current.createTimeMs) {
        latestByCategory.set(categoryKey, buff);
      }
    }
  }
  return latestByCategory;
}
