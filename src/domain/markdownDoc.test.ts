import { describe, expect, it } from "vitest";
import {
  applyBackspace,
  applyEnter,
  applyFormat,
  applyPaste,
  applySourceRange,
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

  it("výběr přes řádky se dá smazat i přepsat", () => {
    const source = "ahoj světe\ndruhý řádek";
    const blocks = parseDocument(source);
    const from = source.indexOf("světe");
    const to = source.indexOf("řádek");
    expect(serializeDocument(applySourceRange(blocks, from, to, "").blocks)).toBe(
      "ahoj řádek"
    );
    expect(serializeDocument(applySourceRange(blocks, from, to, "a ").blocks)).toBe(
      "ahoj a řádek"
    );
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
    const plus = parseInline("volej +420 777 123 456");
    expect(plus.some((run) => run.kind === "link" && run.href?.startsWith("tel:"))).toBe(
      true
    );
  });

  it("podtržení, barva a odkaz na položku se rozloží", () => {
    expect(parseInline("++podtržené++")[0]).toMatchObject({
      kind: "text",
      value: "podtržené",
      underline: true,
      from: 0,
      valueFrom: 2,
      to: 13,
    });
    expect(parseInline("{blue}**tučné**{/}")[0]).toMatchObject({
      kind: "strong",
      value: "tučné",
      color: "blue",
    });
    expect(parseInline("[Úkol](item:abc)")[0]).toMatchObject({
      kind: "link",
      value: "Úkol",
      href: "item:abc",
    });
  });

  it("formát se dá přidat a zase sundat", () => {
    const bold = applyFormat(
      parseDocument("ahoj"),
      { index: 0, caret: 0 },
      { index: 0, caret: 4 },
      { type: "mark", mark: "strong" }
    );
    expect(serializeDocument(bold!.blocks)).toBe("**ahoj**");
    const plain = applyFormat(
      bold!.blocks,
      { index: 0, caret: 2 },
      { index: 0, caret: 6 },
      { type: "mark", mark: "strong" }
    );
    expect(serializeDocument(plain!.blocks)).toBe("ahoj");
    expect(
      applyFormat(
        parseDocument("ahoj"),
        { index: 0, caret: 1 },
        { index: 0, caret: 1 },
        { type: "mark", mark: "em" }
      )
    ).toBeNull();

    const heading = applyFormat(
      parseDocument("ahoj"),
      { index: 0, caret: 2 },
      { index: 0, caret: 2 },
      { type: "heading", level: 2 }
    );
    expect(serializeDocument(heading!.blocks)).toBe("## ahoj");
    const bullet = applyFormat(
      heading!.blocks,
      { index: 0, caret: 0 },
      { index: 0, caret: 0 },
      { type: "bullet" }
    );
    expect(serializeDocument(bullet!.blocks)).toBe("- ahoj");
    const check = applyFormat(
      bullet!.blocks,
      { index: 0, caret: 0 },
      { index: 0, caret: 0 },
      { type: "check" }
    );
    expect(serializeDocument(check!.blocks)).toBe("- [ ] ahoj");

    const colored = applyFormat(
      parseDocument("ahoj"),
      { index: 0, caret: 0 },
      { index: 0, caret: 4 },
      { type: "color", color: "red" }
    );
    expect(serializeDocument(colored!.blocks)).toBe("{red}ahoj{/}");
    expect(colored!.select).toEqual({ index: 0, from: 5, endIndex: 0, to: 9 });
    const linked = applyFormat(
      parseDocument("ahoj"),
      { index: 0, caret: 4 },
      { index: 0, caret: 4 },
      { type: "item", id: "abc", title: "Mléko" }
    );
    expect(serializeDocument(linked!.blocks)).toBe("ahoj[Mléko](item:abc)");
  });
});
