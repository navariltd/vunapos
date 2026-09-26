import { PosCartItem } from "@/features/pos/types";

export type QueuedCheckout = {
  customer?: string;
  items: PosCartItem[];
  posProfile: string;
  priceList?: string;
};

const queuedCheckouts = new Map<string, QueuedCheckout>();

export function registerQueuedCheckout(name: string, checkout: QueuedCheckout) {
  queuedCheckouts.set(name, checkout);
}

export function takeQueuedCheckout(name: string) {
  const checkout = queuedCheckouts.get(name);
  queuedCheckouts.delete(name);
  return checkout;
}

export function clearQueuedCheckouts() {
  queuedCheckouts.clear();
}
