import { describe, expect, it } from "vitest";
import { STICKY_GAP, STICKY_H, STICKY_MAX_H, STICKY_MAX_W, STICKY_MIN_H, STICKY_MIN_W, STICKY_PAD, STICKY_W, clampStickySize, stickyColumns, stickyPaper, stickySlot, stickyTilt } from "./stickies.ts";

describe("lístečky", () => {
  it("skládá volné lístečky do mřížky", () => {
    expect(stickySlot(0, 3)).toEqual({ x: STICKY_PAD, y: STICKY_PAD });
    expect(stickySlot(1, 3).x).toBe(STICKY_PAD + STICKY_W + STICKY_GAP);
    expect(stickySlot(1, 3).y).toBe(STICKY_PAD);
    expect(stickySlot(3, 3)).toEqual({
      x: STICKY_PAD,
      y: STICKY_PAD + STICKY_H + STICKY_GAP,
    });
  });

  it("na úzké ploše dá jeden sloupec", () => {
    expect(stickyColumns(200)).toBe(1);
    expect(stickyColumns(STICKY_W + STICKY_GAP + STICKY_PAD)).toBe(1);
    expect(stickyColumns(STICKY_W * 2 + STICKY_GAP * 2 + STICKY_PAD)).toBe(2);
  });

  it("drží velikost v mezích", () => {
    expect(clampStickySize(10, 10)).toEqual({ width: STICKY_MIN_W, height: STICKY_MIN_H });
    expect(clampStickySize(900, 900)).toEqual({ width: STICKY_MAX_W, height: STICKY_MAX_H });
    expect(clampStickySize(300.4, 200.6)).toEqual({ width: 300, height: 201 });
  });

  it("drží barvu a náklon u stejné poznámky", () => {
    expect(stickyPaper("abc")).toEqual(stickyPaper("abc"));
    expect(stickyTilt("abc")).toBe(stickyTilt("abc"));
    expect(Math.abs(stickyTilt("abc"))).toBeLessThanOrEqual(2.1);
  });
});
