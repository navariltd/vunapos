import { PosCartItem, PosCatalogueItem } from "@/features/pos/types";
import { getVunaMethod } from "@/services/frappeClient";
import {
  patchCachedCatalogueItems,
  PosCataloguePatch,
} from "@/services/posCacheInvalidation";

/**
 * Refreshes only stock rows affected by a committed sale. Pricing is omitted
 * deliberately: customer/price-list rates are cart-contextual and must not
 * overwrite the profile-default catalogue snapshot.
 */
export async function refreshSoldItemStock({
  companyUrl,
  items,
  posProfile,
  sessionId,
}: {
  companyUrl: string;
  items: PosCartItem[];
  posProfile: string;
  sessionId: string;
}) {
  const itemCodes = [...new Set(items.map((item) => item.item_code))];
  const results = await Promise.allSettled(
    itemCodes.map((itemCode) =>
      getVunaMethod<PosCatalogueItem>(
        companyUrl,
        sessionId,
        "vunapos.api.item.get_item_details",
        {
          item_code: itemCode,
          pos_profile: posProfile,
        },
      ),
    ),
  );
  const patches: PosCataloguePatch[] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return;
    patches.push({
      item_code: itemCodes[index],
      actual_qty: result.value.actual_qty,
    });
  });
  if (!patches.length) return;
  try {
    await patchCachedCatalogueItems({ companyUrl, sessionId, patches });
  } catch {
    // The successful transaction remains successful; timestamp delta repair
    // is the recovery path when a local cache write fails.
  }
}
