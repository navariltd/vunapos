import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { kitchenRoutingComplete } from "../kitchenRouting";
import type { KitchenRoutingIssue } from "../types";
import { Sheet } from "./Sheet";

export function KitchenRoutingPicker({
  issue,
  initial = {},
  onConfirm,
  onRetry,
  onClose,
}: {
  issue: KitchenRoutingIssue;
  initial?: Record<string, string>;
  onConfirm: (selections: Record<string, string>) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [selections, setSelections] = useState(initial);
  return (
    <Sheet
      isOpen
      title="Choose kitchen stations"
      description="Choose where to prepare these items. These choices apply to this round only; they do not change station configuration."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Back to cart
          </Button>
          <Button
            disabled={!kitchenRoutingComplete(issue, selections)}
            onClick={() => onConfirm(selections)}
          >
            Use stations
          </Button>
        </div>
      }
    >
      {!issue.stations.length ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-error">
            No enabled, permitted stations are available. Ask a manager to
            configure Kitchen Stations for this Restaurant.
          </p>
          <Button onClick={onRetry}>Check again</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {issue.items.map((item) => (
            <label key={item.item_code} className="block text-sm">
              <span className="font-medium">{item.item_code}</span>
              <span className="ml-2 text-xs text-on-surface-variant">
                {item.item_group} ·{" "}
                {item.reason === "ambiguous"
                  ? "Multiple matches"
                  : item.reason === "invalid"
                  ? "Previous station unavailable"
                  : "No matching station"}
              </span>
              <select
                className="mt-2 min-h-touch w-full rounded-md border border-outline-variant bg-surface px-3"
                value={selections[item.item_code] || ""}
                onChange={(event) =>
                  setSelections((current) => ({
                    ...current,
                    [item.item_code]: event.target.value,
                  }))
                }
              >
                <option value="">Select a station</option>
                {issue.stations.map((station) => (
                  <option key={station.name} value={station.name}>
                    {station.station_name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}
