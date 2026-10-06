import { PosBootstrapData, PosCartSource, PosCatalogueItem } from "@/features/pos/types";
import { PosCacheScope, posCache } from "@/services/posCache";
import { POS_WORKSPACE_RESOURCE } from "@/sync/posResourceKeys";

const saleResources = [
  "catalogue",
  "customer-details",
  "customer-directory",
  "customer-search",
  "invoice-history",
  "payment-history",
] as const;

const returnResources = [
  "catalogue",
  "customer-details",
  "customer-directory",
  "customer-search",
  "invoice-history",
] as const;

type InvalidateSaleCacheArgs = {
  companyUrl: string;
  posProfile: string;
  sessionId: string;
  sourceInvoice?: PosCartSource | null;
};

export type PosCataloguePatch = Pick<PosCatalogueItem, "item_code"> &
  Partial<Pick<PosCatalogueItem, "actual_qty" | "rate" | "price_list_rate">>;

/**
 * Applies authoritative post-sale values to the cached bootstrap snapshot.
 * This updates only affected rows and leaves the rest of the catalogue alone.
 */
export async function patchCachedCatalogueItems({
  companyUrl,
  sessionId,
  patches,
}: {
  companyUrl: string;
  sessionId: string;
  patches: PosCataloguePatch[];
}) {
  if (!patches.length) return;
  const scope: PosCacheScope = {
    companyUrl,
    posProfile: "workspace",
    userId: sessionId,
  };
  const key = { resource: POS_WORKSPACE_RESOURCE, scope } as const;
  const cached = await posCache.read<PosBootstrapData>(key);
  if (!cached?.data.items?.length) return;
  const byCode = new Map(patches.map((patch) => [patch.item_code, patch]));
  let changed = false;
  const items = cached.data.items.map((item) => {
    const patch = byCode.get(item.item_code);
    if (!patch) return item;
    changed = true;
    return {
      ...item,
      ...(patch.actual_qty === undefined ? {} : { actual_qty: patch.actual_qty }),
      ...(patch.rate === undefined ? {} : { rate: patch.rate }),
      ...(patch.price_list_rate === undefined
        ? {}
        : { price_list_rate: patch.price_list_rate }),
    };
  });
  if (!changed) return;
  await posCache.write(
    key,
    { ...cached.data, items },
    Math.max(cached.expiresAt - Date.now(), 1),
  );
  if (cached.isStale) await posCache.markResourceStale(scope, key.resource);
}

/**
 * A submitted sale changes stock, customer balances, and shift reporting.
 * Retain those saved lists for offline browsing, but force their next online
 * reader to validate them with the server.
 */
export async function invalidateSaleCache({
  companyUrl,
  posProfile,
  sessionId,
  sourceInvoice,
}: InvalidateSaleCacheArgs) {
  const scope: PosCacheScope = { companyUrl, posProfile, userId: sessionId };
  const resources = [
    ...saleResources,
    ...(sourceInvoice ? (["held-invoices"] as const) : []),
  ];
  const workspaceScope: PosCacheScope = {
    companyUrl,
    posProfile: "workspace",
    userId: sessionId,
  };

  await Promise.all([
    ...resources.map((resource) => posCache.markResourceStale(scope, resource)),
    posCache.markResourceStale(workspaceScope, POS_WORKSPACE_RESOURCE),
  ]);
}

/** A credit note changes stock and customer balances, but not payment entries. */
export async function invalidateReturnCache({
  companyUrl,
  posProfile,
  sessionId,
}: Omit<InvalidateSaleCacheArgs, "sourceInvoice">) {
  const scope: PosCacheScope = { companyUrl, posProfile, userId: sessionId };
  const workspaceScope: PosCacheScope = {
    companyUrl,
    posProfile: "workspace",
    userId: sessionId,
  };

  await Promise.all([
    ...returnResources.map((resource) =>
      posCache.markResourceStale(scope, resource),
    ),
    posCache.markResourceStale(workspaceScope, POS_WORKSPACE_RESOURCE),
  ]);
}

/** Draft visibility changes only affect held-draft and sale-history lists. */
export async function invalidateHeldInvoiceCache({
  companyUrl,
  posProfile,
  sessionId,
}: Omit<InvalidateSaleCacheArgs, "sourceInvoice">) {
  const scope: PosCacheScope = { companyUrl, posProfile, userId: sessionId };
  await Promise.all(
    ["held-invoices", "invoice-history"].map((resource) =>
      posCache.markResourceStale(scope, resource),
    ),
  );
}

/** Payment receipt and reconciliation change allocations and customer balances. */
export async function invalidateCustomerPaymentCache({
  companyUrl,
  posProfile,
  sessionId,
}: Omit<InvalidateSaleCacheArgs, "sourceInvoice">) {
  const scope: PosCacheScope = { companyUrl, posProfile, userId: sessionId };
  await Promise.all(
    [
      "customer-details",
      "customer-directory",
      "invoice-history",
      "payment-history",
    ].map((resource) => posCache.markResourceStale(scope, resource)),
  );
}

/** Customer writes change searchable and paginated customer records. */
export async function invalidateCustomerDirectoryCache({
  companyUrl,
  posProfile,
  sessionId,
}: Omit<InvalidateSaleCacheArgs, "sourceInvoice">) {
  const scope: PosCacheScope = { companyUrl, posProfile, userId: sessionId };
  await Promise.all(
    ["customer-details", "customer-directory", "customer-search"].map(
      (resource) => posCache.markResourceStale(scope, resource),
    ),
  );
}
