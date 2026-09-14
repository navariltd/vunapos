import { PosCartSource } from "@/features/pos/types";
import { PosCacheScope, posCache } from "@/services/posCache";

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
    posCache.markResourceStale(workspaceScope, "workspace-configuration"),
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
    posCache.markResourceStale(workspaceScope, "workspace-configuration"),
  ]);
}
