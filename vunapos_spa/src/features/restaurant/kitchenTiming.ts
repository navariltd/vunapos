import type { KitchenTicketDTO, KitchenTimingStage } from "./types";

export const KITCHEN_TIMING_STAGES: Record<
  KitchenTimingStage,
  { label: string; live: string }
> = {
  acceptance: { label: "Sent → Accepted", live: "Awaiting acceptance" },
  queue: { label: "Accepted → Preparing", live: "Awaiting preparation" },
  preparation: { label: "Preparing → Ready", live: "Preparing" },
  service: { label: "Ready → Served", live: "Awaiting service" },
};

export function secondsSince(
  since: string | null | undefined,
  now: Date
): number | null {
  if (!since) return null;
  const seconds =
    (now.getTime() - new Date(since.replace(" ", "T")).getTime()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

export function kitchenDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Time not recorded";
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value} sec`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

export function kitchenCardTiming(ticket: KitchenTicketDTO, now: Date) {
  const current = ticket.timing?.current;
  if (current) {
    const seconds = secondsSince(current.since, now);
    return {
      text: `${KITCHEN_TIMING_STAGES[current.stage].live} · ${kitchenDuration(
        seconds
      )}`,
      overdue: seconds !== null && seconds >= 1200,
    };
  }
  if (["Served", "Completed", "Cancelled"].includes(ticket.status)) {
    const seconds = ticket.timing?.finished_at
      ? secondsSince(ticket.timing.sent_at, new Date(ticket.timing.finished_at))
      : null;
    return {
      text: `${ticket.status} · ${kitchenDuration(seconds)}`,
      overdue: false,
    };
  }
  // Old servers/tickets can lack activity times. Only Sent has a safe fallback.
  const fallback =
    ticket.status === "Sent"
      ? "acceptance"
      : ticket.status === "Accepted"
      ? "queue"
      : ticket.status === "Ready"
      ? "service"
      : "preparation";
  const seconds =
    ticket.status === "Sent" ? secondsSince(ticket.sent_at, now) : null;
  return {
    text: `${KITCHEN_TIMING_STAGES[fallback].live} · ${kitchenDuration(
      seconds
    )}`,
    overdue: seconds !== null && seconds >= 1200,
  };
}
