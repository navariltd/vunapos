import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { ItemDTO } from "../types";
import { formatCurrency } from "../utils";

export type TemplateVariant = ItemDTO & {
  attributes?: Array<{ attribute: string; value: string }>;
};

type VariantPickerDialogProps = {
  currency?: string;
  error?: string | null;
  isLoading?: boolean;
  isOpen: boolean;
  template: ItemDTO | null;
  variants: TemplateVariant[];
  onClose: () => void;
  onSelect: (variant: TemplateVariant) => void;
};

export function VariantPickerDialog({
  currency,
  error,
  isLoading,
  isOpen,
  template,
  variants,
  onClose,
  onSelect,
}: VariantPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});

  if (!isOpen || !template) return null;
  const normalizedQuery = query.trim().toLowerCase();
  const attributeValues = variants.reduce<Record<string, string[]>>(
    (result, variant) => {
      for (const attribute of variant.attributes || []) {
        const values = result[attribute.attribute] || [];
        if (!values.includes(attribute.value)) values.push(attribute.value);
        result[attribute.attribute] = values;
      }
      return result;
    },
    {},
  );
  const visibleVariants = variants.filter((variant) => {
    const matchesAttributes = Object.entries(selectedAttributes).every(
      ([attribute, value]) =>
        variant.attributes?.some(
          (entry) => entry.attribute === attribute && entry.value === value,
        ),
    );
    if (!matchesAttributes) return false;
    if (!normalizedQuery) return true;
    return [
      variant.item_code,
      variant.item_name,
      ...(variant.attributes || []).flatMap((attribute) => [
        attribute.attribute,
        attribute.value,
      ]),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-picker-title"
      >
        <header className="flex items-start gap-3 border-b border-outline-variant p-5">
          <div className="min-w-0 flex-1">
            <h2 id="variant-picker-title" className="text-lg font-semibold text-on-surface">
              Select {template.item_name || template.item_code}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Choose a variant before adding the item to the cart.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
            onClick={onClose}
            aria-label="Close variant selector"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="border-b border-outline-variant p-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search variants or attributes"
              className="w-full rounded-md border border-outline-variant bg-surface-container-low py-2 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
              autoFocus
            />
          </label>
          {Object.keys(attributeValues).length ? (
            <div className="mt-4 space-y-3">
              {Object.entries(attributeValues).map(([attribute, values]) => (
                <div key={attribute}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    {attribute}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {values.map((value) => {
                      const selected = selectedAttributes[attribute] === value;
                      return (
                        <button
                          key={`${attribute}-${value}`}
                          type="button"
                          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${selected ? "border-primary bg-primary-container text-on-primary-container" : "border-outline-variant bg-surface-container-low text-on-surface hover:bg-surface-container"}`}
                          aria-pressed={selected}
                          onClick={() =>
                            setSelectedAttributes((current) => {
                              const next = { ...current };
                              if (selected) delete next[attribute];
                              else next[attribute] = value;
                              return next;
                            })
                          }
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              Loading variants…
            </p>
          ) : error ? (
            <p className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
              {error}
            </p>
          ) : visibleVariants.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface-variant">
              No variants found.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleVariants.map((variant) => (
                <div
                  key={variant.item_code}
                  className="flex items-center gap-4 rounded-lg border border-outline-variant bg-surface-container-low p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-on-surface">
                      {variant.item_name || variant.item_code}
                    </p>
                    <p className="text-xs text-on-surface-variant">{variant.item_code}</p>
                    {variant.attributes?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {variant.attributes.map((attribute) => (
                          <span
                            key={`${attribute.attribute}-${attribute.value}`}
                            className="rounded bg-surface-container px-2 py-0.5 text-xs text-on-surface-variant"
                          >
                            {attribute.attribute}: {attribute.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium text-on-surface">
                      {formatCurrency(Number(variant.rate || 0), currency)}
                    </p>
                    <p className={`text-xs ${Number(variant.actual_qty || 0) > 0 ? "text-on-surface-variant" : "text-error"}`}>
                      {Number(variant.actual_qty || 0) > 0
                        ? `${variant.actual_qty} ${variant.stock_uom || "units"} available`
                        : "Out of stock"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={Number(variant.actual_qty || 0) <= 0}
                    onClick={() => onSelect(variant)}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="flex justify-end border-t border-outline-variant p-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </footer>
      </div>
    </div>
  );
}
