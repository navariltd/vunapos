import { PosCartItem } from "@/features/pos/types";

export type QueuedCheckout = {
  customer?: string;
  items: PosCartItem[];
  posProfile: string;
  priceList?: string;
};

const queuedCheckouts = new Map<string, QueuedCheckout>();

function key(companyUrl: string, sessionId: string, name: string) {
  return JSON.stringify([companyUrl, sessionId, name]);
}

export function registerQueuedCheckout(
  companyUrl: string, sessionId: string, name: string, checkout: QueuedCheckout,
) {
  queuedCheckouts.set(key(companyUrl, sessionId, name), checkout);
}

export function takeQueuedCheckout(companyUrl: string, sessionId: string, name: string) {
  const checkoutKey = key(companyUrl, sessionId, name);
  const checkout = queuedCheckouts.get(checkoutKey);
  queuedCheckouts.delete(checkoutKey);
  return checkout;
}

export function clearQueuedCheckouts() {
  queuedCheckouts.clear();
}
