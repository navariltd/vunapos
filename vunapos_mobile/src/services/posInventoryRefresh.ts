import { PosCartItem, PosCatalogueItem } from "@/features/pos/types";
import { getVunaMethod } from "@/services/frappeClient";
import {
  patchCachedCatalogueItems,
  PosCataloguePatch,
} from "@/services/posCacheInvalidation";

/** Refreshes only item rows affected by a committed sale. */
export async function refreshSoldItemStock({
  companyUrl,
  customer,
  items,
  posProfile,
  priceList,
  sessionId,
}: {
  companyUrl: string;
  customer?: string;
  items: PosCartItem[];
  posProfile: string;
  priceList?: string;
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
          customer,
          item_code: itemCode,
          pos_profile: posProfile,
          price_list: priceList,
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
      price_list_rate: result.value.price_list_rate,
      rate: result.value.rate,
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
