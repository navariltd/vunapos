import { describe, expect, it } from "vitest";
import { selectVisitTable, transferFloors } from "../tableTransfer";
import type { FloorPlanDTO, TableStatusDTO } from "../types";

const tables = ["old", "busy", "free", "legacy"].map((name) => ({
  name,
  floor: "f1",
  table_label: name,
  seats: 4,
  shape: "Square" as const,
  x: 0,
  y: 0,
  width: 80,
  height: 80,
  rotation: 0,
  is_active: true,
}));
const floors: FloorPlanDTO["floors"] = [
  {
    name: "f1",
    floor_name: "Main Hall",
    display_order: 0,
    is_active: true,
    background_color: null,
    background_image: null,
    elements: [],
    tables,
  },
];
const statuses: TableStatusDTO[] = [
  {
    table: "busy",
    table_label: "busy",
    floor: "f1",
    seats: 4,
    status: "Occupied",
    orders: [],
  },
  {
    table: "legacy",
    table_label: "legacy",
    floor: "f1",
    seats: 4,
    status: "Occupied",
    orders: [],
  },
];

describe("table transfer destinations", () => {
  it("automatically replaces old selections and keeps only the latest destination", () => {
    const old = ["old", "joined"];
    const first = selectVisitTable(old, "free", "transfer");
    expect(first).toEqual(["free"]);
    expect(selectVisitTable(first, "terrace", "transfer")).toEqual(["terrace"]);
    expect(old).toEqual(["old", "joined"]);
  });

  it("keeps join selections independent from transfer behavior", () => {
    expect(selectVisitTable(["old"], "free", "join")).toEqual(["old", "free"]);
    expect(selectVisitTable(["old", "free"], "free", "join")).toEqual(["old"]);
  });
  it("shows free destinations, not current or occupied tables", () => {
    expect(
      transferFloors(floors, statuses, ["old"])[0].tables.map((row) => row.name)
    ).toEqual(["free"]);
    expect(floors[0].tables).toHaveLength(4);
  });

  it("excludes every current table when moving a joined visit", () => {
    expect(transferFloors(floors, statuses, ["old", "free"])[0].tables).toEqual(
      []
    );
  });

  it("keeps destinations on other floors and does not renumber tables", () => {
    const other = {
      ...floors[0],
      name: "f2",
      floor_name: "Terrace",
      tables: [
        { ...tables[2], name: "terrace", floor: "f2", table_label: "T1" },
      ],
    };
    expect(
      transferFloors([...floors, other], statuses, ["old"])[1].tables[0]
    ).toMatchObject({ name: "terrace", table_label: "T1" });
  });
});
