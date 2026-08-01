import { Camera } from "lucide-react";

type ItemSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onScan: (barcode: string) => void;
  onOpenCamera: () => void;
  isLoading?: boolean;
};

export function ItemSearch({
  isLoading,
  onChange,
  onOpenCamera,
  onScan,
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
      </div>
    </div>
  );
}
