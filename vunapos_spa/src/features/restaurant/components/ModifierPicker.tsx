import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { formatCurrency } from "../../pos/utils";
import type { ModifierGroupDTO, SelectedModifier } from "../types";
import { Sheet } from "./Sheet";
import { modifierSelectionError } from "../modifierSelections";

export function ModifierPicker({
  itemName,
  groups,
  initial = [],
  currency,
  onConfirm,
  onClose,
}: {
  itemName: string;
  groups: ModifierGroupDTO[];
  initial?: SelectedModifier[];
  currency?: string;
  onConfirm: (choices: SelectedModifier[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<
    Array<{ group: string; option: string }>
  >(() =>
    initial
      .filter((choice) =>
        groups.some(
          (group) =>
            group.name === choice.group &&
            group.options.some((option) => option.name === choice.option)
        )
      )
      .map(({ group, option }) => ({ group, option }))
  );
  const error = modifierSelectionError(groups, selected);
  const choices = groups.flatMap((group) =>
    group.options
      .filter((option) =>
        selected.some(
          (choice) =>
            choice.group === group.name && choice.option === option.name
        )
      )
      .map((option) => ({
        group: group.name,
        option: option.name,
        label: `${group.label}: ${option.label}`,
        extra_rate: option.addon_item ? option.rate * option.addon_qty : 0,
      }))
  );
  const extra = choices.reduce((sum, choice) => sum + choice.extra_rate, 0);
  return (
    <Sheet
      isOpen
      title={`Customize ${itemName}`}
      description="Choose options for each unit. Extra prices are estimates; ERPNext calculates final prices and taxes when sent."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Extras: {formatCurrency(extra, currency)}
          </span>
          <Button disabled={Boolean(error)} onClick={() => onConfirm(choices)}>
            Confirm choices
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {groups.map((group) => (
          <fieldset key={group.name}>
            <legend className="text-sm font-semibold">
              {group.label}{" "}
              <span className="text-xs font-normal text-on-surface-variant">
                {group.min_selections ? "Required" : "Optional"} · choose{" "}
                {group.min_selections}–{group.max_selections}
              </span>
            </legend>
            <div className="mt-2 space-y-2">
              {group.options.map((option) => {
                const checked = selected.some(
                  (choice) =>
                    choice.group === group.name && choice.option === option.name
                );
                return (
                  <label
                    key={option.name}
                    className={`flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${
                      checked
                        ? "border-primary bg-primary-container"
                        : "border-outline-variant"
                    } ${!option.available ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={
                        (!option.available && !checked) ||
                        (!checked &&
                          group.max_selections > 1 &&
                          selected.filter(
                            (choice) => choice.group === group.name
                          ).length >= group.max_selections)
                      }
                      onChange={() =>
                        setSelected((current) =>
                          checked
                            ? current.filter(
                                (choice) =>
                                  !(
                                    choice.group === group.name &&
                                    choice.option === option.name
                                  )
                              )
                            : [
                                ...current.filter(
                                  (choice) =>
                                    group.max_selections !== 1 ||
                                    choice.group !== group.name
                                ),
                                { group: group.name, option: option.name },
                              ]
                        )
                      }
                    />
                    <span className="flex-1">
                      {option.label}
                      {!option.available ? " · Unavailable" : ""}
                    </span>
                    {option.addon_item ? (
                      <span className="font-medium">
                        +
                        {formatCurrency(
                          option.rate * option.addon_qty,
                          currency
                        )}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {error ? (
        <p role="status" className="mt-3 text-sm text-on-surface-variant">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
