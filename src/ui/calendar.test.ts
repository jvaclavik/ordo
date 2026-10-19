import { describe, expect, it } from "vitest";
import { newItem } from "../domain/factory.ts";
import type { Item } from "../domain/types.ts";
import { dayMoveIds, orderedDayItems, placeCreatedOnDay } from "./calendar.tsx";

const bare = {
  dueDay: null,
  dueTime: null,
  planFrom: null,
};

function dayItem(
  partial: Pick<Item, "id" | "title"> &
    Partial<Pick<Item, "dueAt" | "dueHasTime" | "plannedFor" | "priority" | "dayOrder">>
): Item {
  return {
    dueAt: null,
    dueHasTime: false,
    plannedFor: "2026-10-19",
    planUntil: null,
    priority: null,
    dayOrder: null,
    ...partial,
  } as Item;
}

describe("pořadí dne v kalendáři", () => {
  const open = () => true;

  it("bez ručního pořadí dává dřív termín s časem a vyšší prioritu", () => {
    const items = [
      dayItem({ id: "plan", title: "Plán", priority: "urgent" }),
      dayItem({
        id: "late",
        title: "Pozdě",
        dueAt: "2026-10-19T15:00",
        dueHasTime: true,
        plannedFor: null,
      }),
      dayItem({
        id: "early",
        title: "Brzy",
        dueAt: "2026-10-19T09:00",
        dueHasTime: true,
        plannedFor: null,
      }),
    ];
    expect(orderedDayItems(items, "2026-10-19", open).map((item) => item.id)).toEqual([
      "early",
      "late",
      "plan",
    ]);
  });

  it("ruční pořadí přebije čas a prioritu", () => {
    const items = [
      dayItem({
        id: "early",
        title: "Brzy",
        dueAt: "2026-10-19T09:00",
        dueHasTime: true,
        plannedFor: null,
        dayOrder: "b",
      }),
      dayItem({ id: "plan", title: "Plán", priority: "low", dayOrder: "a" }),
    ];
    expect(orderedDayItems(items, "2026-10-19", open).map((item) => item.id)).toEqual([
      "plan",
      "early",
    ]);
  });

  it("přesune úkol před jiný a stejné místo nechá být", () => {
    expect(dayMoveIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dayMoveIds(["a", "b", "c"], "a", "b")).toBeNull();
    expect(dayMoveIds(["a", "b"], "a", "a")).toBeNull();
  });
});

describe("úkol přidaný v kalendáři", () => {
  const item = newItem({ id: "a", folderId: "f", title: "Koupit mléko" });

  it("bez data dostane plán na zvolený den", () => {
    const placed = placeCreatedOnDay(item, "2026-10-23", bare);
    expect(placed.plannedFor).toBe("2026-10-23");
    expect(placed.planUntil).toBeNull();
    expect(placed.dueAt).toBeNull();
    expect(placed.dueHasTime).toBe(false);
  });

  it("čas bez dne dá termín na zvolený den", () => {
    const placed = placeCreatedOnDay(item, "2026-10-23", {
      ...bare,
      dueTime: "09:00",
    });
    expect(placed.dueAt).toBe("2026-10-23T09:00");
    expect(placed.dueHasTime).toBe(true);
    expect(placed.plannedFor).toBeNull();
  });

  it("vlastní termín nebo plán nechá být", () => {
    const due = placeCreatedOnDay(
      { ...item, dueAt: "2026-10-24", dueHasTime: false },
      "2026-10-23",
      { ...bare, dueDay: "2026-10-24" }
    );
    expect(due.dueAt).toBe("2026-10-24");
    expect(due.plannedFor).toBeNull();
    const plan = placeCreatedOnDay(
      { ...item, plannedFor: "2026-10-20", planUntil: "2026-10-25" },
      "2026-10-23",
      { ...bare, planFrom: "2026-10-20" }
    );
    expect(plan.plannedFor).toBe("2026-10-20");
    expect(plan.planUntil).toBe("2026-10-25");
  });
});
