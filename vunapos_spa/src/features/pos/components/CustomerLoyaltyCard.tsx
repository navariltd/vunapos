import { Award } from "lucide-react";

import type { CustomerLoyaltyDTO } from "../types";
import { formatCurrency } from "../utils";

type Props = {
  currency?: string;
  data?: CustomerLoyaltyDTO | null;
  error?: string | null;
  isLoading?: boolean;
};

export function CustomerLoyaltyCard({
  currency,
  data,
  error,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div
        className="mt-2 h-20 animate-pulse rounded-md bg-surface-container-low"
        aria-label="Loading loyalty balance"
      />
    );
  }
  if (error) {
    return <p className="mt-2 text-xs text-error">{error}</p>;
  }
  if (!data?.enrolled) return null;

  return (
    <div className="mt-2 rounded-md border border-tertiary/40 bg-tertiary-container/30 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-tertiary-container text-on-tertiary-container">
          <Award className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-on-surface">
                {data.program || "Loyalty program"}
              </p>
              {data.tier ? (
                <p className="truncate text-xs text-on-surface-variant">
                  {data.tier}
                </p>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-semibold text-on-surface">
              {data.points.toLocaleString()} pts
            </p>
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xs">
            <span className="text-on-surface-variant">Redeemable value</span>
            <span className="font-medium text-on-surface">
              {formatCurrency(data.redemption_value, data.currency || currency)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
