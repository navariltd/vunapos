import source from "../../../../../vunapos/vunapos/doctype/kitchen_station/kitchen_station.js?raw";
import { describe, expect, it, vi } from "vitest";

function form() {
  let handlers: Record<string, (document: unknown) => Promise<void> | void> =
    {};
  const queries = new Map<string, () => { filters: Record<string, unknown> }>();
  const get = vi
    .fn()
    .mockResolvedValue({ message: { branch: "Town", company: "Company" } });
  const frm = {
    doc: { restaurant: "Cafe", branch: "", company: "Company" } as Record<
      string,
      unknown
    >,
    restaurant_branch: null,
    set_query: (
      field: string,
      query: () => { filters: Record<string, unknown> }
    ) => queries.set(field, query),
    set_value: vi.fn(
      async (field: string | Record<string, unknown>, value?: unknown) => {
        Object.assign(
          frm.doc,
          typeof field === "string" ? { [field]: value } : field
        );
      }
    ),
  };
  new Function("frappe", source)({
    ui: {
      form: {
        on: (_name: string, value: typeof handlers) => {
          handlers = value;
        },
      },
    },
    db: { get_value: get },
  });
  handlers.setup(frm);
  return { frm, handlers, queries, get };
}

describe("Kitchen Station dependent links", () => {
  it("filters Restaurants by Company and Branch by the selected Restaurant", async () => {
    const { frm, handlers, queries } = form();
    expect(queries.get("restaurant")!().filters).toEqual({
      company: "Company",
      enabled: 1,
    });
    expect(queries.get("branch")!().filters.name).toBe("");
    await handlers.restaurant(frm);
    expect(frm.doc.branch).toBe("Town");
    expect(queries.get("branch")!().filters).toEqual({
      name: "Town",
      vunapos_company: "Company",
    });
  });
  it("clears incompatible Restaurant and Branch when Company changes", async () => {
    const { frm, handlers } = form();
    frm.doc.company = "Other Company";
    await handlers.company(frm);
    expect(frm.doc.restaurant).toBeNull();
    expect(frm.doc.branch).toBeNull();
  });
  it("ignores stale lookup results after another Restaurant is picked", async () => {
    const { frm, handlers, get } = form();
    let resolve!: (value: unknown) => void;
    get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = handlers.restaurant(frm);
    frm.doc.restaurant = "Another Cafe";
    resolve({ message: { company: "Wrong Company", branch: "Wrong Branch" } });
    await pending;
    expect(frm.doc.branch).toBe("");
    expect(frm.doc.company).toBe("Company");
  });
});
