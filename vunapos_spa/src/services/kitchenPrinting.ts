type Qz = {
  websocket: { isActive(): boolean; connect(): Promise<void> };
  printers: { find(name: string): Promise<string>; find(): Promise<string[]> };
  configs: { create(name: string, options: object): unknown };
  print(config: unknown, data: object[]): Promise<void>;
};
let loading: Promise<Qz> | undefined;
let connecting: Promise<void> | undefined;
export function connectKitchenPrinter(): Promise<Qz> {
  const global = window as unknown as { qz?: Qz };
  loading ||= new Promise<Qz>((resolve, reject) => {
    if (global.qz) return resolve(global.qz);
    const script = document.createElement("script");
    script.src = "/assets/frappe/node_modules/qz-tray/qz-tray.js";
    script.onload = () => global.qz ? resolve(global.qz) : reject(new Error("QZ library unavailable"));
    script.onerror = () => { script.remove(); reject(new Error("Unable to load QZ Tray")); };
    document.head.appendChild(script);
  }).catch((error) => { loading = undefined; throw error; });
  return loading.then(async (qz) => {
    if (!qz.websocket.isActive()) {
      connecting ||= qz.websocket.connect().finally(() => { connecting = undefined; });
      await connecting;
    }
    return qz;
  });
}

export async function prepareKitchenPrinter(name: string) {
  const qz = await connectKitchenPrinter();
  const found = await qz.printers.find(name);
  if (found !== name) throw new Error("Configured printer was not found by its exact name.");
  return (html: string) => qz.print(qz.configs.create(name, { jobName: "Kitchen Order Ticket", copies: 1, units: "mm", margins: 0, scaleContent: false }),
    [{ type: "pixel", format: "html", flavor: "plain", data: html }]);
}

export type KitchenDeliveryApi = {
  claim(): Promise<{name: string; token: string; printer: string} | null>;
  dispatch(job: {name: string; token: string}): Promise<{html: string; error?: string}>;
  acknowledge(job: {name: string; token: string}, submitted: boolean, error?: string): Promise<unknown>;
};
export async function deliverKitchenJob(api: KitchenDeliveryApi, active: () => boolean,
  prepare = prepareKitchenPrinter) {
  const job = await api.claim();
  if (!job) return false;
  const identity = {name: job.name, token: job.token};
  let sending = false;
  try {
    const print = await prepare(job.printer);
    if (!active()) return;
    sending = true;
    const payload = await api.dispatch(identity);
    if (payload.error) { sending = false; throw new Error(payload.error); }
    await print(payload.html);
    await api.acknowledge(identity, true);
    return true;
  } catch (error) {
    if (sending) {
      try { await api.acknowledge(identity, false, error instanceof Error ? error.message : "Delivery interrupted"); }
      catch { /* The server lease flags unresolved sending jobs for review. */ }
    }
    throw error;
  }
}


export async function listAvailablePrinters(): Promise<string[]> {
  const qz = await connectKitchenPrinter();
  const printers = await qz.printers.find();
  return Array.isArray(printers) ? printers : [printers];
}
export function escapePrintText(text: string) {
  return text.replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[char]!);
}
export async function printTestSlip(name: string, stationLabel: string) {
  const print = await prepareKitchenPrinter(name);
  await print(`<div style="width:68mm;padding:2mm;font-family:monospace"><h2>PRINTER ALIGNMENT TEST</h2><p>${escapePrintText(stationLabel)}</p><p>${escapePrintText(name)}</p><p>80mm roll / 72mm printable area</p><hr><p>TEST ONLY — NOT AN ORDER</p></div>`);
}
