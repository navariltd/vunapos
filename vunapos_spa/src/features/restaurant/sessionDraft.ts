import { newOrderDraft, type OrderDraft } from "./orderDraft";
import type { RestaurantSessionDTO } from "./types";

export function newSessionRound(
  session: RestaurantSessionDTO,
  key: string
): OrderDraft {
  const table = session.tables.find((row) => !row.released_at);
  const draft = newOrderDraft({
    pos_profile: session.pos_profile,
    service_type: session.service_type,
    table: table?.table,
    table_label: table?.table_label,
    customer: session.customer,
    customer_name: session.customer_name,
    idempotency_key: key,
  });
  return {
    ...draft,
    restaurant_session: session.name,
    header: { ...draft.header, pax: session.guest_count },
  };
}

export function committedSessionTotal(session: RestaurantSessionDTO): number {
  return session.rounds
    .filter((round) => round.status !== "Cancelled")
    .reduce((total, round) => total + Number(round.grand_total || 0), 0);
}
