import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  activeSelectionFloors,
  findFloorTables,
  initialSelectionFloor,
  uniqueExactFloorTable,
} from "../floorPlanSelection";
import { TablePlanPicker } from "../components/TablePlanPicker";
import type {
  FloorPlanDTO,
  RestaurantFloorDTO,
  RestaurantTableDTO,
} from "../types";

function table(name: string, label: string, active = true): RestaurantTableDTO {
  return {
    name,
    table_label: label,
    floor: "main",
    seats: 4,
    shape: "Round",
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    is_active: active,
  };
}
function floor(
  name: string,
  tables: RestaurantTableDTO[],
  active = true
): RestaurantFloorDTO {
  return {
    name,
    floor_name: name,
    display_order: 0,
    is_active: active,
    elements: [],
    tables,
  };
}
const floors = [
  floor("Main", [
    table("one", "T1"),
    table("ten", "T10"),
    table("hidden", "T9", false),
  ]),
  floor("Terrace", [table("other-one", "1")]),
  floor("Closed", [table("closed", "T5")], false),
];

describe("visual floor plan selection", () => {
  it("excludes inactive floors and tables", () => {
    expect(activeSelectionFloors(floors).map((row) => row.name)).toEqual([
      "Main",
      "Terrace",
    ]);
    expect(findFloorTables(floors, "9")).toEqual([]);
    expect(findFloorTables(floors, "5")).toEqual([]);
  });
  it("starts on the selected table's floor and safely falls back", () => {
    expect(initialSelectionFloor(floors, ["other-one"])).toBe("Terrace");
    expect(initialSelectionFloor(floors, ["missing"])).toBe("Main");
    expect(initialSelectionFloor([], [])).toBeNull();
  });
  it("searches across floors without losing floor identity", () => {
    expect(
      findFloorTables(floors, " 1 ").map(
        (row) => `${row.floor.name}:${row.table.name}`
      )
    ).toEqual(["Main:one", "Main:ten", "Terrace:other-one"]);
  });
  it("never auto-assigns an ambiguous number or a partial number", () => {
    expect(uniqueExactFloorTable(floors, "1")).toBeNull();
    expect(
      uniqueExactFloorTable([floor("Main", [table("ten", "T10")])], "1")
    ).toBeNull();
    expect(uniqueExactFloorTable(floors, "10")?.table.name).toBe("ten");
    expect(uniqueExactFloorTable(floors, " T10 ")?.table.name).toBe("ten");
  });
  it("renders the real SVG plan in a responsive full-screen/large overlay", () => {
    const plan: FloorPlanDTO = {
      pos_profile: "Till",
      pos_mode: "Restaurant",
      canvas: { width: 1000, height: 700 },
      version: "v1",
      can_edit: false,
      floors,
    };
    const html = renderToStaticMarkup(
      <TablePlanPicker
        plan={plan}
        statuses={[]}
        selectedTables={["one"]}
        multiple
        onClose={() => {}}
        onSelect={() => {}}
        onRetry={() => {}}
        footer={<button>Confirm tables</button>}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("h-[100dvh]");
    expect(html).toContain("sm:max-w-7xl");
    expect(html).toContain('aria-label="Main floor plan"');
    expect(html).toContain('viewBox="0 0 1000 700"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Confirm tables");
    expect(html).toContain("Find table number");
    expect(html).not.toContain("Closed</span>");
  });
});
