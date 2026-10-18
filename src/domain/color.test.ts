import { describe, expect, it } from "vitest";
import { normalizeFolderColor, paintCss } from "./color.ts";

describe("barva složky", () => {
  it("nechá paletu a přijme vlastní hex", () => {
    expect(normalizeFolderColor("c4")).toBe("c4");
    expect(normalizeFolderColor("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeFolderColor("blue")).toBeNull();
    expect(normalizeFolderColor(null)).toBeNull();
    expect(paintCss("c1")).toBe("var(--c1)");
    expect(paintCss("#aabbcc")).toBe("#aabbcc");
    expect(paintCss(null)).toBe("var(--c4)");
  });
});
