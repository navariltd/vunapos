import type { RequestLine } from "./types";

export type RequestDraft = {
  workflow?: string | null;
  submitAllowed?: boolean;
  name?: string;
  modified?: string;
  key: string;
  lines: RequestLine[];
  requiredBy: string;
  notes: string;
};

export function requestDraftScope(
  user: string,
  profile: string,
  warehouse: string,
  name?: string
) {
  return JSON.stringify(
    name ? [user, profile, warehouse, "edit", name] : [user, profile, warehouse]
  );
}

export function clearRequestDraft(
  draft: RequestDraft,
  editing = false
): RequestDraft {
  return editing ? { ...draft, lines: [] } : newRequestDraft();
}
export function newRequestDraft(): RequestDraft {
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    key:
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lines: [],
    requiredBy: today,
    notes: "",
  };
}
export function loadRequestDraft(scope: string): RequestDraft {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(`vunapos:request:${scope}`) || "null"
    );
    if (
      typeof value?.key === "string" &&
      value.key.length > 0 &&
      typeof value.requiredBy === "string" &&
      typeof value.notes === "string" &&
      Array.isArray(value.lines) &&
      value.lines.every(
        (line: RequestLine) =>
          line.item?.item_code &&
          line.uom &&
          Array.isArray(line.item.uoms) &&
          Number.isFinite(line.qty)
      )
    )
      return value;
  } catch {
    /* Storage is optional; requests still use an in-memory retry key. */
  }
  return newRequestDraft();
}
export function saveRequestDraft(scope: string, draft: RequestDraft) {
  try {
    sessionStorage.setItem(`vunapos:request:${scope}`, JSON.stringify(draft));
  } catch {
    /* Private browsing can disable storage. */
  }
}
export function addRequestLine(
  lines: RequestLine[],
  item: RequestLine["item"],
  atTop: boolean,
  scannedUom?: string | null
) {
  const uom =
    scannedUom && item.uoms.some((row) => row.uom === scannedUom)
      ? scannedUom
      : item.sales_uom && item.uoms.some((row) => row.uom === item.sales_uom)
      ? item.sales_uom
      : item.stock_uom;
  if (
    lines.some(
      (line) => line.item.item_code === item.item_code && line.uom === uom
    )
  ) {
    return lines.map((line) =>
      line.item.item_code === item.item_code && line.uom === uom
        ? { ...line, qty: line.qty + 1 }
        : line
    );
  }
  const row = { item, uom, qty: 1 };
  return atTop ? [row, ...lines] : [...lines, row];
}
