import { useState, type ReactNode } from "react";
import { ShoppingCart, X } from "lucide-react";
import type { ItemDTO } from "../types";
import { ItemGrid } from "./ItemGrid";
import { ItemSearch, type CatalogueView } from "./ItemSearch";

type Props = {
  items?: ItemDTO[];
  isLoading?: boolean;
  currency?: string;
  hideImages?: boolean;
  ignoreStock?: boolean;
  pendingItemCode?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  view: CatalogueView;
  onViewChange: (view: CatalogueView) => void;
  onScan: (value: string) => void;
  onOpenCamera: () => void;
  onAddItem: (item: ItemDTO) => void;
  categories?: ReactNode;
  children: ReactNode;
  mobileCart?: ReactNode;
  cartQuantity?: number;
  mobileCartOpen?: boolean;
  onMobileCartOpenChange?: (open: boolean) => void;
};

/** The main selling surface shared by retail and restaurant workflows. */
export function SellingWorkspace(props: Props) {
  const [localCartOpen, setLocalCartOpen] = useState(false);
  const cartOpen = props.mobileCartOpen ?? localCartOpen;
  const setCartOpen = props.onMobileCartOpenChange || setLocalCartOpen;
  return (
    <>
      <div className="grid min-h-0 flex-1 overflow-hidden border-t border-outline-variant bg-surface pb-[68px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_clamp(32rem,32vw,38rem)]">
        <section className="flex min-w-0 min-h-0 flex-col p-4">
          <ItemSearch
            value={props.query}
            onChange={props.onQueryChange}
            isLoading={props.isLoading}
            view={props.view}
            onViewChange={props.onViewChange}
            onScan={props.onScan}
            onOpenCamera={props.onOpenCamera}
          />
          {props.categories}
          <div
            data-pos-scroll
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <ItemGrid
              items={props.items}
              isLoading={props.isLoading}
              currency={props.currency}
              hideImages={props.hideImages}
              ignoreStock={props.ignoreStock}
              pendingItemCode={props.pendingItemCode}
              onAddItem={props.onAddItem}
              view={props.view}
            />
          </div>
        </section>
        {props.children}
      </div>
      {props.mobileCart ? (
        <>
          <button
            type="button"
            aria-label="Open cart"
            className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-md xl:hidden"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingCart className="size-6" />
            {props.cartQuantity ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-error px-2 text-xs text-on-error">
                {props.cartQuantity}
              </span>
            ) : null}
          </button>
          {cartOpen ? (
            <div
              className="fixed inset-0 z-50 bg-black/40 xl:hidden"
              role="presentation"
              onClick={() => setCartOpen(false)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Cart"
                className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-surface"
                onClick={(e) => e.stopPropagation()}
              >
                <header className="flex justify-between border-b border-outline-variant p-4">
                  <strong>Cart</strong>
                  <button
                    type="button"
                    aria-label="Close cart"
                    onClick={() => setCartOpen(false)}
                  >
                    <X className="size-5" />
                  </button>
                </header>
                {props.mobileCart}
              </section>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
