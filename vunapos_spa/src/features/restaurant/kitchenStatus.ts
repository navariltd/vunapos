import type { KitchenAction } from "./types";

export const KITCHEN_ACTION_LABELS: Record<KitchenAction, string> = {
  Accept: "Accept",
  Start: "Start preparing",
  Ready: "Mark ready",
  Serve: "Mark served",
  "Undo Serve": "Correct served quantity",
  "Cancel Remake": "Cancel replacement",
};

export function kitchenStatusClass(status: string) {
  if (status === "Completed")
    return "bg-surface-container-high text-on-surface-variant";
  if (status === "Ready" || status === "Served")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "Preparing")
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (status === "Cancelled")
    return "bg-error-container text-on-error-container";
  return "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200";
}

export function kitchenElapsedMinutes(ticket: {sent_at: string; server_now?: string; received_at?: number}, now: number) {
  const sent = Date.parse(ticket.sent_at.replace(" ", "T"));
  const server = ticket.server_now && ticket.received_at !== undefined
    ? Date.parse(ticket.server_now) + Math.max(0, now - ticket.received_at) : now;
  return Math.max(0, Math.floor((server - sent) / 60000));
}
