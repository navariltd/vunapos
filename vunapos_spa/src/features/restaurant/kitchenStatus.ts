import type { KitchenAction } from "./types";

export const KITCHEN_ACTION_LABELS: Record<KitchenAction, string> = {
  Accept: "Accept",
  Start: "Start preparing",
  Ready: "Mark ready",
  Serve: "Mark served",
};

export function kitchenStatusClass(status: string) {
  if (status === "Ready" || status === "Served")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "Preparing")
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (status === "Cancelled")
    return "bg-error-container text-on-error-container";
  return "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200";
}
