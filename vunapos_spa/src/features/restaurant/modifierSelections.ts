import type { ModifierGroupDTO } from "./types";

export function modifierSelectionError(
  groups: ModifierGroupDTO[],
  selected: Array<{ group: string; option: string }>
): string | null {
  if (
    selected.some(
      (choice) => !groups.some((group) => group.name === choice.group)
    )
  )
    return "Review unavailable modifier groups.";
  if (
    new Set(selected.map((choice) => `${choice.group}:${choice.option}`))
      .size !== selected.length
  )
    return "A choice cannot be selected twice.";
  for (const group of groups) {
    const choices = selected.filter((choice) => choice.group === group.name);
    if (
      choices.some(
        (choice) =>
          !group.options.some(
            (option) => option.name === choice.option && option.available
          )
      )
    )
      return `Review unavailable choices in ${group.label}.`;
    if (
      choices.length < group.min_selections ||
      choices.length > group.max_selections
    )
      return `Choose ${
        group.min_selections === group.max_selections
          ? group.min_selections
          : `${group.min_selections}–${group.max_selections}`
      } for ${group.label}.`;
  }
  return null;
}
