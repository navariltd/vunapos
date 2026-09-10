import { Camera, Grid2X2, List } from "lucide-react";

export type CatalogueView = "grid" | "list";

type ItemSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onScan: (barcode: string) => void;
  onOpenCamera: () => void;
  isLoading?: boolean;
  view?: CatalogueView;
  onViewChange?: (view: CatalogueView) => void;
};

export function ItemSearch({
  isLoading,
  onChange,
  onOpenCamera,
  onScan,
  onViewChange,
  view = "grid",
  value,
}: ItemSearchProps) {
  return (
    <div className="sticky top-0 z-20 border-b border-outline-variant bg-surface pb-4">
      <div className="flex items-center gap-3">
        <input
          id="item-search"
          aria-label="Search or scan barcode"
          autoFocus
          className="h-touch flex-1 rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary"
          placeholder="Search by item name, code, or barcode"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) {
              event.preventDefault();
              onScan(value);
            }
          }}
        />
        <button
          type="button"
          className="flex h-touch shrink-0 cursor-pointer items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm font-medium text-on-surface hover:bg-surface-container"
          onClick={onOpenCamera}
          aria-label="Scan with camera"
        >
          <Camera className="size-4" />{" "}
          <span className="hidden sm:inline">Scan</span>
        </button>
        {isLoading ? (
          <span className="text-sm text-on-surface-variant">Searching...</span>
        ) : null}
        {onViewChange ? (
          <div className="hidden shrink-0 items-center rounded-md border border-outline-variant bg-surface-container-low p-0.5 sm:flex">
            <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded ${view === "grid" ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant hover:bg-surface-container"}`} onClick={() => onViewChange("grid")}>
              <Grid2X2 className="size-4" />
            </button>
            <button type="button" aria-label="List view" aria-pressed={view === "list"} className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded ${view === "list" ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant hover:bg-surface-container"}`} onClick={() => onViewChange("list")}>
              <List className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
