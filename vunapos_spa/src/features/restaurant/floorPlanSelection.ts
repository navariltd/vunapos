import type { RestaurantFloorDTO } from "./types";

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/^table\s+/, "").replace(/^t(?=\d)/, "");

export function activeSelectionFloors(floors: RestaurantFloorDTO[]) {
  return floors
    .filter((floor) => floor.is_active)
    .map((floor) => ({
      ...floor,
      tables: floor.tables.filter((table) => table.is_active),
    }));
}

export function findFloorTables(floors: RestaurantFloorDTO[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return activeSelectionFloors(floors).flatMap((floor) =>
    floor.tables
      .filter((table) => table.table_label.toLocaleLowerCase().includes(needle) || normalize(table.table_label).includes(normalize(query)))
      .map((table) => ({ floor, table }))
  );
}

export function initialSelectionFloor(
  floors: RestaurantFloorDTO[],
  selected: readonly string[]
) {
  const active = activeSelectionFloors(floors);
  return (
    active.find((floor) =>
      floor.tables.some((table) => selected.includes(table.name))
    )?.name ??
    active[0]?.name ??
    null
  );
}

export function uniqueExactFloorTable(
  floors: RestaurantFloorDTO[],
  query: string
) {
  const needle = normalize(query);
  if (!needle) return null;
  const matches = activeSelectionFloors(floors).flatMap((floor) =>
    floor.tables
      .filter((table) => normalize(table.table_label) === needle)
      .map((table) => ({ floor, table }))
  );
  return matches.length === 1 ? matches[0] : null;
}
