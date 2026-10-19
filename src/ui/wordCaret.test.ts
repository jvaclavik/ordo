import { describe, expect, it } from "vitest";
import { rangeAfterWordJump, wordBoundary } from "./wordCaret.ts";

const text = "koupit letenky";

describe("skok po slovech", () => {
  it("jde na konec slova doprava a na začátek doleva", () => {
    expect(wordBoundary(text, 0, 1)).toBe(6);
    expect(wordBoundary(text, 6, 1)).toBe(14);
    expect(wordBoundary(text, 3, 1)).toBe(6);
    expect(wordBoundary(text, 14, -1)).toBe(7);
    expect(wordBoundary(text, 7, -1)).toBe(0);
    expect(wordBoundary(text, 3, -1)).toBe(0);
    expect(wordBoundary(text, 6, -1)).toBe(0);
  });

  it("přeskočí interpunkci mezi slovy", () => {
    const punctuated = "ahoj, světe";
    expect(wordBoundary(punctuated, 0, 1)).toBe(4);
    expect(wordBoundary(punctuated, 4, 1)).toBe(11);
    expect(wordBoundary(punctuated, 11, -1)).toBe(6);
  });

  it("bez shiftu sbalí výběr a skočí z jeho okraje", () => {
    expect(rangeAfterWordJump(text, 0, 6, 1, false, "forward")).toEqual({
      start: 14,
      end: 14,
      direction: "none",
    });
    expect(rangeAfterWordJump(text, 0, 6, -1, false, "forward")).toEqual({
      start: 0,
      end: 0,
      direction: "none",
    });
  });

  it("se shiftem výběr rozšíří", () => {
    expect(rangeAfterWordJump(text, 0, 0, 1, true, "none")).toEqual({
      start: 0,
      end: 6,
      direction: "forward",
    });
    expect(rangeAfterWordJump(text, 14, 14, -1, true, "none")).toEqual({
      start: 7,
      end: 14,
      direction: "backward",
    });
  });
});
