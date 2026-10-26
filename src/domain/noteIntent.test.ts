import { describe, expect, it } from "vitest";
import { splitNoteDraft, takeNoteIntent } from "./noteIntent.ts";

describe("takeNoteIntent", () => {
  it("sežere úvodní pokyn a nechá text poznámky", () => {
    expect(takeNoteIntent("Přidej novou poznámku recept na guláš")).toEqual({
      note: true,
      text: "recept na guláš",
    });
    expect(takeNoteIntent("nová poznámka: seznam na víkend")).toEqual({
      note: true,
      text: "seznam na víkend",
    });
    expect(takeNoteIntent("přidat poznámku")).toEqual({
      note: true,
      text: "",
    });
    expect(takeNoteIntent("pridej novou poznamku ahoj")).toEqual({
      note: true,
      text: "ahoj",
    });
    expect(takeNoteIntent("Novou poznámku zítra zavolat")).toEqual({
      note: true,
      text: "zítra zavolat",
    });
    expect(takeNoteIntent("chci novou poznámku nápad")).toEqual({
      note: true,
      text: "nápad",
    });
  });

  it("vezme i uložení do poznámek, včetně přeslechu", () => {
    expect(takeNoteIntent("Ulož po poznámek koupit mléko")).toEqual({
      note: true,
      text: "koupit mléko",
    });
    expect(takeNoteIntent("Ulož do poznámek\nvíce\nřádků")).toEqual({
      note: true,
      text: "více\nřádků",
    });
    expect(takeNoteIntent("recept na guláš ulož do poznámek")).toEqual({
      note: true,
      text: "recept na guláš",
    });
  });

  it("obyčejný úkol nechá být", () => {
    expect(takeNoteIntent("Zavolat a nechat poznámku")).toEqual({
      note: false,
      text: "Zavolat a nechat poznámku",
    });
    expect(takeNoteIntent("Přidat úkol zavolat")).toEqual({
      note: false,
      text: "Přidat úkol zavolat",
    });
    expect(takeNoteIntent("")).toEqual({ note: false, text: "" });
  });
});

describe("splitNoteDraft", () => {
  it("vezme název z prvního řádku", () => {
    expect(splitNoteDraft("Název\n\nodstavec")).toEqual({
      title: "Název",
      body: "Název\n\nodstavec",
    });
    expect(splitNoteDraft("   ")).toBeNull();
    expect(splitNoteDraft("## Nadpis\ntext")?.title).toBe("Nadpis");
    expect(splitNoteDraft("- [ ] Mléko")?.title).toBe("Mléko");
  });
});