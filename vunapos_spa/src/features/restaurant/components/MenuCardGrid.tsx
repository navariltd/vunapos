import { ItemCard } from "../../pos/components/ItemCard";
import type { ItemDTO } from "../../pos/types";
import type { MenuItemDTO } from "../types";

type MenuCardGridProps = {
  items: MenuItemDTO[];
  currency?: string;
  tagFor: (item: MenuItemDTO) => string | null;
  onAdd: (item: ItemDTO) => void;
};

// The retail item cards, with columns set by the menu pane's own width (a
// container query) rather than the screen's, since the order panel sits beside it.
export function MenuCardGrid({ items, currency, tagFor, onAdd }: MenuCardGridProps) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-4">
        {items.map((item) => {
          const tag = tagFor(item);
          return (
            <li key={item.item_code} className="flex min-w-0 flex-col gap-1">
              {tag ? <MenuTag text={tag} /> : null}
              <div className="min-h-0 flex-1 [&>*]:h-full">
                <ItemCard currency={currency} item={item} onAdd={onAdd} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MenuTag({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full self-start truncate rounded-full bg-tertiary-container px-2 py-0.5 text-[11px] font-medium text-on-tertiary-container">
      {text}
    </span>
  );
}
