import type { FrappeCall } from "../../services/vunaApi";
import {
  createSessionRound,
  openRestaurantSession,
  recoverSessionRound,
} from "../../services/vunaApi";
import type { OrderLineInput, RestaurantSessionDTO } from "./types";

export type PendingPlacement = {
  key: string;
  pos_profile: string;
  session: string | null;
  opening: Parameters<typeof openRestaurantSession>[1];
  items: OrderLineInput[];
  order_note?: string | null;
  kitchen_routing?: Record<string, string>;
};

// Always use the saved intent, never the cart that happens to be on screen.
export async function placePending(
  intent: PendingPlacement,
  calls: {
    open: FrappeCall;
    round: FrappeCall;
    recover: FrappeCall;
    get: (name: string) => Promise<RestaurantSessionDTO>;
  },
  rememberSession: (visit: RestaurantSessionDTO) => void,
  recovering: boolean
) {
  const params = {
    pos_profile: intent.pos_profile,
    idempotency_key: intent.key,
    session: intent.session || undefined,
    items: intent.items,
    order_note: intent.order_note,
    kitchen_routing: intent.kitchen_routing,
  };
  if (recovering) {
    const recovered = await recoverSessionRound(calls.recover, params);
    if (recovered?.session && recovered.order) return recovered.session;
  }
  const visit = intent.session
    ? await calls.get(intent.session)
    : await openRestaurantSession(calls.open, intent.opening);
  rememberSession(visit);
  await createSessionRound(calls.round, { ...params, session: visit.name });
  return visit;
}
