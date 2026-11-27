import {
  kitchenRollConfig,
  kitchenRollHtml,
  measureKitchenRoll,
} from "./kitchenRoll";
import { configureKitchenSigning, type QzSigning } from "./kitchenSigning";

type Qz = QzSigning & {
  websocket: { isActive(): boolean; connect(): Promise<void> };
  printers: { find(name: string): Promise<string>; find(): Promise<string[]> };
  configs: { create(name: string, options: object): unknown };
  print(config: unknown, data: object[]): Promise<void>;
};
let loading: Promise<Qz> | undefined;
let connecting: Promise<void> | undefined;
let signing: { qz: Qz; profile: string; ready: Promise<void> } | undefined;
export function connectKitchenPrinter(posProfile?: string): Promise<Qz> {
  const global = window as unknown as { qz?: Qz };
  loading ||= new Promise<Qz>((resolve, reject) => {
    if (global.qz) return resolve(global.qz);
    const script = document.createElement("script");
    script.src = "/assets/frappe/node_modules/qz-tray/qz-tray.js";
    script.onload = () =>
      global.qz
        ? resolve(global.qz)
        : reject(new Error("QZ library unavailable"));
    script.onerror = () => {
      script.remove();
      reject(new Error("Unable to load QZ Tray"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading.then(async (qz) => {
    if (!posProfile)
      throw new Error(
        "Select a POS Profile before connecting kitchen printing."
      );
    if (!signing || signing.qz !== qz || signing.profile !== posProfile) {
      const ready = configureKitchenSigning(qz, posProfile);
      signing = { qz, profile: posProfile, ready };
      ready.catch(() => {
        if (signing?.ready === ready) signing = undefined;
      });
    }
    await signing.ready;
    if (!qz.websocket.isActive()) {
      connecting ||= qz.websocket.connect().finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
    return qz;
  });
}

export async function prepareKitchenPrinter(name: string, posProfile?: string) {
  const qz = await connectKitchenPrinter(posProfile);
  const found = await qz.printers.find(name);
  if (found !== name)
    throw new Error("Configured printer was not found by its exact name.");
  return async (html: string) => {
    const roll = kitchenRollHtml(html);
    const height = await measureKitchenRoll(roll);
    return qz.print(qz.configs.create(name, kitchenRollConfig(height)), [
      {
        type: "pixel",
        format: "html",
        flavor: "plain",
        data: roll,
        options: { pageWidth: 80, pageHeight: height },
      },
    ]);
  };
}

export type KitchenDeliveryApi = {
  claim(): Promise<{ name: string; token: string; printer: string } | null>;
  release(job: { name: string; token: string }): Promise<unknown>;
  dispatch(job: {
    name: string;
    token: string;
  }): Promise<{ html: string; error?: string }>;
  acknowledge(
    job: { name: string; token: string },
    submitted: boolean,
    error?: string
  ): Promise<unknown>;
};
export async function deliverKitchenJob(
  api: KitchenDeliveryApi,
  active: () => boolean,
  prepare = prepareKitchenPrinter
) {
  const job = await api.claim();
  if (!job) return false;
  const identity = { name: job.name, token: job.token };
  async function releaseBeforeDispatch() {
    try {
      await api.release(identity);
    } catch {
      // If release cannot reach the server, lease recovery still applies.
    }
  }

  let print: Awaited<ReturnType<typeof prepareKitchenPrinter>>;

  try {
    print = await prepare(job.printer);
  } catch (error) {
    await releaseBeforeDispatch();
    throw error;
  }

  if (!active()) {
    await releaseBeforeDispatch();
    return false;
  }

  let sending = false;
  try {
    sending = true;
    const payload = await api.dispatch(identity);
    if (payload.error) {
      sending = false;
      throw new Error(payload.error);
    }
    await print(payload.html);
    await api.acknowledge(identity, true);
    return true;
  } catch (error) {
    if (sending) {
      try {
        await api.acknowledge(
          identity,
          false,
          error instanceof Error ? error.message : "Delivery interrupted"
        );
      } catch {
        /* The server lease flags unresolved sending jobs for review. */
      }
    }
    throw error;
  }
}

export async function listAvailablePrinters(
  posProfile?: string
): Promise<string[]> {
  const qz = await connectKitchenPrinter(posProfile);
  const printers = await qz.printers.find();
  return Array.isArray(printers) ? printers : [printers];
}
export function escapePrintText(text: string) {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        char
      ]!)
  );
}
export async function printTestSlip(
  name: string,
  stationLabel: string,
  posProfile?: string
) {
  const print = await prepareKitchenPrinter(name, posProfile);
  await print(
    `<div style="width:68mm;padding:2mm;font-family:monospace"><h2>PRINTER ALIGNMENT TEST</h2><p>${escapePrintText(
      stationLabel
    )}</p><p>${escapePrintText(
      name
    )}</p><p>80mm roll / 72mm printable area</p><hr><p>TEST ONLY — NOT AN ORDER</p></div>`
  );
}

/**
 * Drain independent station queues without letting a delivery error
 * stop unrelated stations. Server-side delivery states remain authoritative.
 */
export function createKitchenStationDrainer(
  stations: string[],
  deliver: (station: string) => Promise<boolean | undefined>,
  onResult: (station: string, error: string | null) => void,
  now = Date.now
) {
  let cursor = 0;
  const retryAfter = new Map<string, number>();

  return async function drain(active: () => boolean) {
    let misses = 0;
    let delivered = 0;

    while (active() && delivered < 50 && misses < stations.length) {
      const station = stations[cursor++ % stations.length];

      if ((retryAfter.get(station) ?? 0) > now()) {
        misses++;
        continue;
      }

      try {
        const printed = await deliver(station);

        if (printed) {
          misses = 0;
          delivered++;
          retryAfter.delete(station);
          if (active()) onResult(station, null);
        } else {
          misses++;
        }
      } catch (caught) {
        misses++;
        retryAfter.set(station, now() + 15000);

        if (active()) {
          onResult(
            station,
            caught instanceof Error
              ? caught.message
              : "Delivery interrupted. Review printing status."
          );
        }
      }
    }
  };
}
