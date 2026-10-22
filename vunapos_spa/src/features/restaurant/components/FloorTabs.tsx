import { cn } from "../../../lib/cn";

export type FloorTab = {
  key: string;
  label: string;
  inactive?: boolean;
};

type FloorTabsProps = {
  tabs: FloorTab[];
  activeKey: string | null;
  onChange: (key: string) => void;
};

export function FloorTabs({ tabs, activeKey, onChange }: FloorTabsProps) {
  return (
    <div role="tablist" aria-label="Floors" className="flex min-w-0 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={cn(
              "flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
              tab.inactive && !isActive && "opacity-60",
            )}
            onClick={() => onChange(tab.key)}
          >
            <span className="max-w-40 truncate">{tab.label}</span>
            {tab.inactive ? (
              <span className="rounded-full bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Inactive
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
