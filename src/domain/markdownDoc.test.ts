import { describe, expect, it } from "vitest";
import {
  applyBackspace,
  applyEnter,
  applyPaste,
  applyText,
  parseDocument,
  parseInline,
  serializeDocument,
} from "./markdownDoc.ts";

function type(source: string, caret: number) {
  const blocks = parseDocument("");
  const next = applyText(blocks, 0, source, caret);
  return serializeDocument(next.blocks);
}

describe("markdown se vykreslí ze stejného zápisu", () => {
  it("kolem dokola zachová nadpis, seznam, úkol a kód", () => {
    const source = "# Nadpis\n\n- mléko\n1. první\n- [ ] koupit\n\n{{task:abc}}\n\n```ts\nconst a = 1\n```";
    expect(serializeDocument(parseDocument(source))).toBe(source);
  });

  it("mezera za značkou hned udělá blok", () => {
    expect(type("# ", 2)).toBe("# ");
    expect(type("# Ahoj", 2)).toBe("# Ahoj");
    expect(type("## ", 3)).toBe("## ");
    expect(type("### ", 4)).toBe("### ");
    expect(type("- ", 2)).toBe("- ");
    expect(type("- mléko", 2)).toBe("- mléko");
    expect(type("* ", 2)).toBe("* ");
    expect(type("1. ", 3)).toBe("1. ");
    expect(type("> ", 2)).toBe("> ");
    expect(type("[] ", 3)).toBe("- [ ] ");
  });

  it("značku uprostřed věty nechá textem", () => {
    expect(type("a # ", 4)).toBe("a # ");
    expect(type("viz - ", 6)).toBe("viz - ");
  });

  it("enter v seznamu přidá položku a prázdná ho ukončí", () => {
    const list = parseDocument("- mléko");
    const split = applyEnter(list, 0, "mléko".length);
    expect(serializeDocument(split.blocks)).toBe("- mléko\n- ");
    expect(split).toMatchObject({ index: 1, caret: 0 });
    const numbered = applyEnter(parseDocument("1. první"), 0, "první".length);
    expect(serializeDocument(numbered.blocks)).toBe("1. první\n2. ");
    const empty = applyEnter(parseDocument("- "), 0, 0);
    expect(serializeDocument(empty.blocks)).toBe("");
    const nested = applyEnter(parseDocument("  - "), 0, 0);
    expect(serializeDocument(nested.blocks)).toBe("- ");
  });

  it("enter v nadpisu pokračuje odstavcem", () => {
    const next = applyEnter(parseDocument("# Nadpis"), 0, "Nadpis".length);
    expect(serializeDocument(next.blocks)).toBe("# Nadpis\n");
    expect(next).toMatchObject({ index: 1, caret: 0 });
  });

  it("backspace na začátku nadpisu z něj udělá odstavec", () => {
    const next = applyBackspace(parseDocument("# Nadpis"), 0, 0);
    expect(serializeDocument(next?.blocks ?? [])).toBe("Nadpis");
  });

  it("vložený markdown se rozpadne na bloky", () => {
    const next = applyPaste(parseDocument(""), 0, 0, "# Nadpis\n- bod");
    expect(serializeDocument(next.blocks)).toBe("# Nadpis\n- bod");
  });

  it("tučné, kód a odkaz se rozloží, telefon zůstane textem odkazu", () => {
    expect(parseInline("**tučné** a `kód`").map((run) => [run.kind, run.value])).toEqual([
      ["strong", "tučné"],
      ["text", " a "],
      ["code", "kód"],
    ]);
    const phone = parseInline("volej 777 123 456");
    expect(phone.some((run) => run.kind === "link" && run.value.includes("777"))).toBe(true);
  });
});
