import { describe, expect, it } from "vitest";
import { boardSlot, slotChanges, undoDragShift } from "./boardDrop.ts";

const cards = [
  { id: "a", top: 0, height: 40 },
  { id: "b", top: 48, height: 40 },
  { id: "c", top: 96, height: 40 },
];

describe("řazení na nástěnce", () => {
  it("horní polovina karty zařadí před ni a dolní za ni", () => {
    expect(boardSlot(cards, 10, null)).toBe("a");
    expect(boardSlot(cards, 30, null)).toBe("b");
    expect(boardSlot(cards, 44, null)).toBe("b");
    expect(boardSlot(cards, 80, null)).toBe("c");
    expect(boardSlot(cards, 130, null)).toBe(null);
  });

  it("taženou kartu při výpočtu místa vynechá", () => {
    expect(boardSlot(cards, 60, "b")).toBe("c");
    expect(boardSlot(cards, 10, "b")).toBe("a");
  });

  it("okraj karty drží místo jako u složek", () => {
    expect(boardSlot(cards, 4, null)).toBe("a");
    expect(boardSlot(cards, 36, null)).toBe("b");
    expect(boardSlot(cards, 16, null, "a")).toBe("a");
    expect(boardSlot(cards, 20, null, "a")).toBe("b");
  });

  it("vrátí řádky na místa před mezerou a sbalením", () => {
    const source = { top: 100, height: 48 };
    const gap = { top: 200, height: 48 };
    expect(undoDragShift(248, source, gap)).toBe(248);
    expect(undoDragShift(150, source, gap)).toBe(198);
    expect(undoDragShift(80, source, gap)).toBe(80);
  });

  it("stejné místo nepočítá jako posun", () => {
    expect(slotChanges(["a", "b", "c"], "b", "c")).toBe(false);
    expect(slotChanges(["a", "b", "c"], "b", null)).toBe(true);
    expect(slotChanges(["a", "b", "c"], "c", "a")).toBe(true);
    expect(slotChanges(["a", "b"], "z", null)).toBe(true);
  });
});
