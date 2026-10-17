import { describe, expect, it } from "vitest";
import { folderDropIntent, folderDropLabel, folderHit, settleIntent } from "./folderDrop.ts";

describe("řazení složek", () => {
  it("okraj zařadí nad nebo pod a prostředek dovnitř", () => {
    expect(folderDropIntent(4, 0, 40, false)).toBe("before");
    expect(folderDropIntent(20, 0, 40, false)).toBe("inside");
    expect(folderDropIntent(36, 0, 40, false)).toBe("after");
  });

  it("s Altem přesune dovnitř", () => {
    expect(folderDropIntent(4, 0, 40, true)).toBe("inside");
  });

  it("drží poslední záměr, dokud ukazatel nepřejde dál", () => {
    expect(folderDropIntent(16, 0, 40, false, "before")).toBe("before");
    expect(folderDropIntent(20, 0, 40, false, "before")).toBe("inside");
    expect(folderDropIntent(8, 0, 40, false, "inside")).toBe("inside");
    expect(folderDropIntent(2, 0, 40, false, "inside")).toBe("before");
  });

  it("trefí řádek pod ukazatelem a přeskočí taženou složku", () => {
    const rows = [
      { id: "a", top: 0, height: 40 },
      { id: "b", top: 40, height: 40 },
    ];
    expect(folderHit(rows, 42, "a", false)).toEqual({ id: "b", intent: "before" });
    expect(folderHit(rows, 10, "a", false)).toBeNull();
    expect(folderHit(rows, 60, null, false)).toEqual({ id: "b", intent: "inside" });
  });

  it("pojmenuje složku, do které položka spadne", () => {
    expect(folderDropLabel("inside", "Dům", null)).toBe("Do složky Dům");
    expect(folderDropLabel("before", "test", "Dům")).toBe("Ve složce Dům");
    expect(folderDropLabel("after", "mm", null)).toBe("Na nejvyšší úrovni");
  });

  it("neplatné vnoření spadne na řazení", () => {
    expect(settleIntent("inside", false, true, 0.2)).toBe("before");
    expect(settleIntent("inside", false, false, 0.2)).toBeNull();
    expect(settleIntent("before", true, false, 0.1)).toBe("inside");
    expect(settleIntent("after", true, true, 0.9)).toBe("after");
  });
});
