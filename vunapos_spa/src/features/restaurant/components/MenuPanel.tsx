import { useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../lib/cn";
import { ItemGrid } from "../../pos/components/ItemGrid";
import type { CatalogueView } from "../../pos/components/ItemSearch";
import type { ItemDTO } from "../../pos/types";
import type { MenuDTO } from "../types";
import { MenuListRow } from "./MenuListRow";

type MenuPanelProps = {
  menu: MenuDTO | null;
  isLoading: boolean;
  error: string | null;
  currency?: string;
  disabled?: boolean;
  // Item code -> quantity already on the order, shown on the phone list's buttons.
  quantities: Map<string, number>;
  onRetry: () => void;
  onAddItem: (item: ItemDTO) => void;
};

const ALL = "__all__";

// The menu for the order's service type and table: category tabs, search, and
// the items as compact rows on phones or the retail item grid from md up. Items
// with variants are listed separately, disabled (stage 1).
export function MenuPanel({ menu, isLoading, error, currency, disabled, quantities, onRetry, onAddItem }: MenuPanelProps) {
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CatalogueView>("grid");

  if (!menu) {
    return isLoading ? (
      <EmptyState title="Loading menu" description="Fetching the menu for this order." />
    ) : (
      <EmptyState
        title="Menu unavailable"
        description={error || "The menu could not be loaded."}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }

  const activeCategory = menu.categories.some((row) => row.item_group === category) ? category : ALL;
  const needle = query.trim().toLowerCase();
  const visible = menu.items.filter(
    (item) =>
      (activeCategory === ALL || item.menu_category === activeCategory) &&
      (!needle || item.item_name.toLowerCase().includes(needle) || item.item_code.toLowerCase().includes(needle)),
  );
  const orderable = visible.filter((item) => !item.has_variants);
  const templates = visible.filter((item) => item.has_variants);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search the menu</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search the menu"
            className="h-11 w-full rounded-md border border-outline-variant bg-surface pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          className="hidden size-11 shrink-0 p-0 md:flex"
          aria-label={view === "grid" ? "Show as list" : "Show as grid"}
          title={view === "grid" ? "Show as list" : "Show as grid"}
          onClick={() => setView(view === "grid" ? "list" : "grid")}
        >
          {view === "grid" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
        </Button>
      </div>
      {menu.categories.length ? (
        <div className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-1" role="tablist" aria-label="Menu categories">
          {[{ item_group: ALL, label: "All" }, ...menu.categories].map((row) => (
            <button
              key={row.item_group}
              type="button"
              role="tab"
              aria-selected={activeCategory === row.item_group}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors",
                activeCategory === row.item_group
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container",
              )}
              onClick={() => setCategory(row.item_group)}
            >
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain", disabled && "pointer-events-none opacity-60")}>
        {orderable.length || !templates.length ? (
          <>
            <div className="md:hidden">
              {orderable.length ? (
                <ul className="divide-y divide-outline-variant">
                  {orderable.map((item) => (
                    <MenuListRow
                      key={item.item_code}
                      item={item}
                      qty={quantities.get(item.item_code) ?? 0}
                      currency={currency}
                      onAdd={onAddItem}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState title="No items found" description="Try another name or category." />
              )}
            </div>
            <div className="hidden md:block">
              <ItemGrid currency={currency} items={orderable} view={view} onAddItem={onAddItem} />
            </div>
          </>
        ) : null}
        {templates.length ? (
          <div className="mt-4 rounded-md border border-dashed border-outline-variant p-3">
            <p className="text-sm font-medium text-on-surface">Variants not supported yet</p>
            <p className="text-xs text-on-surface-variant">These items have variants and can't be ordered here yet.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {templates.map((item) => (
                <li key={item.item_code}>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="h-9 cursor-not-allowed rounded-md border border-outline-variant px-3 text-sm text-on-surface-variant opacity-70"
                  >
                    {item.item_name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
