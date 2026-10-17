import { describe, expect, it } from "vitest";
import { continueMarkdownList } from "./markdownEdit.ts";

function at(source: string) {
  const cursor = source.indexOf("|");
  const value = source.replace("|", "");
  return { value, cursor };
}

function press(source: string) {
  const { value, cursor } = at(source);
  const next = continueMarkdownList(value, cursor, cursor);
  if (!next) return null;
  return next.value.slice(0, next.cursor) + "|" + next.value.slice(next.cursor);
}

describe("pokračování seznamu v markdownu", () => {
  it("enter přidá další odrážku", () => {
    expect(press("- mléko|")).toBe("- mléko\n- |");
    expect(press("* mléko|")).toBe("* mléko\n* |");
    expect(press("  - mléko|")).toBe("  - mléko\n  - |");
  });

  it("enter uprostřed textu rozdělí položku", () => {
    expect(press("- mlé|ko")).toBe("- mlé\n- |ko");
  });

  it("druhý enter na prázdné odrážce seznam ukončí", () => {
    expect(press("- mléko\n- |")).toBe("- mléko\n|");
    expect(press("- |")).toBe("|");
  });

  it("prázdná vnořená odrážka se vrátí o úroveň výš", () => {
    expect(press("- dům\n  - |")).toBe("- dům\n- |");
    expect(press("    - |")).toBe("  - |");
  });

  it("číslovaný seznam zvýší číslo a prázdná položka ho ukončí", () => {
    expect(press("1. první|")).toBe("1. první\n2. |");
    expect(press("1) první|")).toBe("1) první\n2) |");
    expect(press("2. |")).toBe("|");
  });

  it("zaškrtávací políčko pokračuje prázdným políčkem", () => {
    expect(press("- [ ] mléko|")).toBe("- [ ] mléko\n- [ ] |");
    expect(press("- [x] mléko|")).toBe("- [x] mléko\n- [ ] |");
    expect(press("- [ ] |")).toBe("|");
  });

  it("obyčejný řádek nechá enter na prohlížeči", () => {
    expect(press("ahoj|")).toBeNull();
    expect(press("---|")).toBeNull();
    expect(press("*kurziva*|")).toBeNull();
  });
});
