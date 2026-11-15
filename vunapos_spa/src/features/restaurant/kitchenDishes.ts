import type { KitchenTicketDTO } from "./types";

type Line = KitchenTicketDTO["items"][number];
type Choice = { label: string; addon_item?: string | null };

// Presentation only: retain every source line, keyed by its immutable line ID.
export function kitchenDishGroups(items: Line[]) {
  const ids = new Set(items.map((line) => line.line_id));
  return items
    .filter((line) => !line.parent_line_id || !ids.has(line.parent_line_id))
    .map((dish) => {
      const choices: Choice[] = dish.modifiers;
      const used = new Set<number>();
      const addons = items
        .filter((line) => line.parent_line_id === dish.line_id)
        .map((line) => {
          let index = choices.findIndex(
            (choice, position) =>
              !used.has(position) &&
              line.line_id === `${dish.line_id}:addon:${position}` &&
              choice.addon_item === line.item_code
          );
          if (index < 0)
            index = choices.findIndex(
              (choice, position) =>
                !used.has(position) &&
                (choice.addon_item === line.item_code ||
                  choice.label === line.item_name)
            );
          if (index >= 0) used.add(index);
          const label = choices[index]?.label || line.item_name;
          // Hide only the exact generated reference, never arbitrary kitchen notes.
          const generated = `Add-on for ${dish.item_code}: ${label}`;
          return {
            line,
            label,
            note: line.note === generated ? null : line.note,
          };
        });
      return {
        dish,
        addons,
        modifiers: choices.filter((_, index) => !used.has(index)),
      };
    });
}
