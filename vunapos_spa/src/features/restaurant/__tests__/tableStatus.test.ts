import { describe, expect, it } from "vitest";

import type { CachedServiceType } from "../../../lib/types";
import {
	deriveTableStatuses,
	elapsedLabel,
	legendStatuses,
	parseServerDatetime,
	statusFor,
	tableAccessibleName,
	tableServiceType,
	tableStatusBadge,
	tableStatusLines,
	tableTapAction,
	waitersLabel,
} from "../tableStatus";
import type { TableStatusDTO } from "../types";

const order = (name: string, openedAt: string, pax: number, waiter: string, waiterName: string | null) => ({
	name,
	service_type: "Dine In",
	pax,
	waiter,
	waiter_name: waiterName,
	opened_at: openedAt,
});

const rows: TableStatusDTO[] = [
	{ table: "t1", table_label: "T1", floor: "f", seats: 4, status: "Free", orders: [] },
	{
		table: "t2",
		table_label: "T2",
		floor: "f",
		seats: 6,
		status: "Occupied",
		orders: [
			order("VRO-9", "2026-10-27 12:30:00", 2, "brian@x", "Brian Otieno"),
			order("VRO-7", "2026-10-27 12:00:00", 3, "jane@x", "Jane Wanjiku"),
			order("VRO-8", "2026-10-27 12:10:00", 1, "jane@x", "Jane Wanjiku"),
		],
	},
	{ table: "t3", table_label: "T3", floor: "f", seats: 2, status: "Occupied", orders: [order("VRO-5", "2026-10-27 11:00:00", 0, "mary@x", null)] },
];

describe("deriveTableStatuses", () => {
	const statuses = deriveTableStatuses(rows);

	it("sums guests, starts the clock at the earliest order and lists waiters once", () => {
		const t2 = statusFor(statuses, "t2");
		expect(t2.kind).toBe("occupied");
		expect(t2.guests).toBe(6);
		expect(t2.openedAt).toBe("2026-10-27 12:00:00");
		expect(t2.orders.map((row) => row.name)).toEqual(["VRO-7", "VRO-8", "VRO-9"]);
		expect(t2.waiters).toEqual(["Jane Wanjiku", "Brian Otieno"]);
	});

	it("falls back to the user id when the waiter has no name", () => {
		expect(statusFor(statuses, "t3").waiters).toEqual(["mary@x"]);
	});

	it("treats free and unknown tables as free", () => {
		expect(statusFor(statuses, "t1").kind).toBe("free");
		expect(statusFor(statuses, "new-table").kind).toBe("free");
	});
});

describe("legendStatuses", () => {
	it("shows only the statuses in use, in a fixed order", () => {
		const statuses = deriveTableStatuses(rows);
		expect(legendStatuses(statuses.values())).toEqual(["free", "occupied"]);
		expect(legendStatuses(deriveTableStatuses([rows[2]]).values())).toEqual(["occupied"]);
		expect(legendStatuses([])).toEqual([]);
	});
});

describe("elapsedLabel", () => {
	const now = new Date("2026-10-27T13:05:30");
	it("counts minutes, then hours and minutes", () => {
		expect(elapsedLabel("2026-10-27 13:05:10", now)).toBe("now");
		expect(elapsedLabel("2026-10-27 12:53:00.123456", now)).toBe("12 min");
		expect(elapsedLabel("2026-10-27 12:05:00", now)).toBe("1 h");
		expect(elapsedLabel("2026-10-27 10:40:00", now)).toBe("2 h 25 min");
	});

	it("parses the server's microsecond timestamps", () => {
		expect(parseServerDatetime("2026-10-27 12:06:53.232631").getTime()).toBe(new Date("2026-10-27T12:06:53.232").getTime());
		expect(parseServerDatetime("2026-10-27 12:06:53").getMinutes()).toBe(6);
	});

	it("never goes negative and ignores bad values", () => {
		expect(elapsedLabel("2026-10-27 14:00:00", now)).toBe("now");
		expect(elapsedLabel(null, now)).toBeNull();
		expect(elapsedLabel("not a date", now)).toBeNull();
	});
});

describe("tableTapAction", () => {
	const statuses = deriveTableStatuses(rows);
	it("starts an order on a free table", () => {
		expect(tableTapAction(statusFor(statuses, "t1"), false)).toEqual({ kind: "start" });
	});
	it("opens the oldest open order on an occupied table", () => {
		expect(tableTapAction(statusFor(statuses, "t2"), false)).toEqual({ kind: "open", order: "VRO-7" });
	});
	it("lets the user choose when several orders per table are allowed", () => {
		const action = tableTapAction(statusFor(statuses, "t2"), true);
		expect(action.kind).toBe("choose");
	});
});

describe("tableServiceType", () => {
	const type = (name: string, order: number, requiresTable: boolean, isDefault = false): CachedServiceType => ({
		name,
		service_type_name: name,
		requires_table: requiresTable,
		display_order: order,
		is_default: isDefault,
	});

	it("uses the default type when it needs a table", () => {
		expect(tableServiceType([type("Takeaway", 1, false), type("Dine In", 2, true, true)])?.name).toBe("Dine In");
	});

	it("otherwise the first table type in display order", () => {
		const types = [type("Takeaway", 1, false, true), type("Terrace", 3, true), type("Dine In", 2, true)];
		expect(tableServiceType(types)?.name).toBe("Dine In");
		expect(tableServiceType([type("Takeaway", 1, false, true)])).toBeNull();
	});
});

describe("table text", () => {
	const statuses = deriveTableStatuses(rows);
	const now = new Date("2026-10-27T12:45:00");

	it("puts the status word first, then guests and waiter", () => {
		expect(tableStatusLines(statusFor(statuses, "t1"), 4, now)).toEqual(["Free", "4 seats"]);
		expect(tableStatusLines(statusFor(statuses, "t2"), 6, now)).toEqual(["Occupied · 45 min", "6 guests · Jane +1"]);
		expect(tableStatusLines(statusFor(statuses, "t3"), 2, now)).toEqual(["Occupied · 1 h 45 min", "mary"]);
	});

	it("gives screen readers the full picture", () => {
		expect(tableAccessibleName("T2", 6, statusFor(statuses, "t2"), now)).toBe(
			"Table T2, 6 seats, occupied, 6 guests, waiter Jane Wanjiku, Brian Otieno, open 45 min",
		);
		expect(tableAccessibleName("T1", 1, statusFor(statuses, "t1"), now)).toBe("Table T1, 1 seat, free");
	});

	it("adds a status badge whenever status text is dropped", () => {
		const t2 = statusFor(statuses, "t2");
		const lines = tableStatusLines(t2, 6, now);
		expect(tableStatusBadge(t2, lines, lines.length)).toBeNull();
		expect(tableStatusBadge(t2, lines, 1)).toBe("occupied");
		expect(tableStatusBadge(t2, lines, 0)).toBe("occupied");
		const t1 = statusFor(statuses, "t1");
		expect(tableStatusBadge(t1, tableStatusLines(t1, 4, now), 0)).toBe("free");
	});

	it("shortens waiter names", () => {
		expect(waitersLabel([])).toBe("");
		expect(waitersLabel(["Jane Wanjiku"])).toBe("Jane");
		expect(waitersLabel(["jane.doe@example.com", "Brian"])).toBe("jane.doe +1");
	});
});
