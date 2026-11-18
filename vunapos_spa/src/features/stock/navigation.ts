import { useNavigationStore } from "../../lib/stores/navigationStore";

export type StockView = "requests" | "transfers";
export function stockPath(view: StockView, name?: string, receipt?: string) {
  return `/vunapos/stock-transfers/${view}${
    name ? `/${encodeURIComponent(name)}` : ""
  }${
    receipt && view === "transfers" && name
      ? `/receipts/${encodeURIComponent(receipt)}`
      : ""
  }`;
}
export function stockRoute(path: string): {
  view?: StockView;
  name?: string;
  receipt?: string;
  editing?: boolean;
} {
  const editMatch = path.match(
    /^\/vunapos\/stock-transfers\/requests\/([^/]+)\/edit\/?$/
  );
  if (editMatch) {
    try {
      return {
        view: "requests",
        name: decodeURIComponent(editMatch[1]),
        editing: true,
      };
    } catch {
      return {};
    }
  }
  const match = path.match(
    /^\/vunapos\/stock-transfers\/(requests|transfers)(?:\/([^/]+)(?:\/receipts\/([^/]+))?)?\/?$/
  );
  if (!match) return {};
  try {
    if (match[3] && match[1] !== "transfers") return {};
    return {
      view: match[1] as StockView,
      name: match[2] ? decodeURIComponent(match[2]) : undefined,
      ...(match[3] ? { receipt: decodeURIComponent(match[3]) } : {}),
    };
  } catch {
    return {};
  }
}
export function navigateToStock(
  view: StockView,
  name?: string,
  receipt?: string
) {
  window.history.pushState(
    { vunaposPage: "End Transit" },
    "",
    stockPath(view, name, receipt)
  );
  useNavigationStore.getState().setActivePage("End Transit");
}

export function navigateToRequestEdit(name: string) {
  window.history.pushState(
    { vunaposPage: "End Transit" },
    "",
    `${stockPath("requests", name)}/edit`
  );
  useNavigationStore.getState().setActivePage("End Transit");
}
