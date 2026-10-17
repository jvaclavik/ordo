import { describe, expect, it } from "vitest";
import { splitUrls } from "./links.ts";

describe("odkazy v textu", () => {
  it("nechá běžný text být", () => {
    expect(splitUrls("Koupit chleba")).toEqual([
      { kind: "text", value: "Koupit chleba" },
    ]);
  });

  it("udělá z adresy odkaz a oddělí koncovou tečku", () => {
    expect(splitUrls("viz https://example.com/a.")).toEqual([
      { kind: "text", value: "viz " },
      {
        kind: "url",
        value: "https://example.com/a",
        href: "https://example.com/a",
      },
      { kind: "text", value: "." },
    ]);
  });

  it("doplní https u www a nechá závorku, která patří k adrese", () => {
    expect(
      splitUrls("www.example.com a https://cs.wikipedia.org/wiki/Dům_(stavba)")
    ).toEqual([
      {
        kind: "url",
        value: "www.example.com",
        href: "https://www.example.com",
      },
      { kind: "text", value: " a " },
      {
        kind: "url",
        value: "https://cs.wikipedia.org/wiki/Dům_(stavba)",
        href: "https://cs.wikipedia.org/wiki/Dům_(stavba)",
      },
    ]);
  });
});
