import { describe, expect, it } from "vitest";
import { newItem } from "../domain/factory.ts";
import { placeCreatedOnDay } from "./calendar.tsx";

const bare = {
  dueDay: null,
  dueTime: null,
  planFrom: null,
};

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
