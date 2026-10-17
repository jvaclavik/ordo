import { describe, expect, it } from "vitest";
import { findHorizons, planIsDue, planLabel, planOnDay } from "./horizon.ts";
import { fold } from "./text.ts";

const friday = "2026-10-16";
const saturday = "2026-10-17";

function first(text: string, today: string) {
  return findHorizons(fold(text), today)[0]?.horizon ?? null;
}

describe("období", () => {
  it("pozná jaro, tři měsíce a víkend", () => {
    expect(first("vysadit javor na jaře", saturday)).toEqual({
      from: "2027-03-01",
      until: "2027-05-31",
      label: "jaro",
    });
    expect(first("koupit beton do třech měsíců", saturday)).toEqual({
      from: saturday,
      until: "2027-01-17",
      label: "do 3 měsíců",
    });
    expect(first("koupit beton do tří měsíců", saturday)?.until).toBe("2027-01-17");
    expect(first("koupit beton do 3 měsíců", saturday)?.label).toBe("do 3 měsíců");
    expect(first("vypnout topení na víkend", saturday)).toEqual({
      from: "2026-10-17",
      until: "2026-10-18",
      label: "víkend",
    });
    expect(first("vypnout topení na víkend", friday)).toEqual({
      from: "2026-10-17",
      until: "2026-10-18",
      label: "víkend",
    });
  });

  it("nebere slovo javor ani adresu", () => {
    expect(first("vysadit javor", saturday)).toBeNull();
    expect(first("návod https://example.com/jaro", saturday)).toBeNull();
  });

  it("posune roční období, která už letos skončila", () => {
    expect(first("na podzim", saturday)).toEqual({
      from: "2026-09-01",
      until: "2026-11-30",
      label: "podzim",
    });
    expect(first("v zimě", saturday)?.from).toBe("2026-12-01");
    expect(first("v zimě", "2026-01-10")).toEqual({
      from: "2025-12-01",
      until: "2026-02-28",
      label: "zima",
    });
    expect(first("na jaře", "2026-04-02")?.from).toBe("2026-03-01");
    expect(first("na jaře", "2026-06-01")?.from).toBe("2027-03-01");
  });

  it("krátké období patří do dneška, dlouhé až ke konci", () => {
    expect(planIsDue("2026-10-17", "2026-10-18", saturday)).toBe(true);
    expect(planIsDue("2027-03-01", "2027-05-31", saturday)).toBe(false);
    expect(planIsDue(saturday, "2027-01-17", saturday)).toBe(false);
    expect(planIsDue(saturday, "2027-01-17", "2027-01-12")).toBe(true);
    expect(planIsDue("2027-03-01", "2027-05-31", "2027-05-28")).toBe(true);
    expect(planIsDue("2026-10-20", null, saturday)).toBe(false);
    expect(planIsDue("2026-10-16", null, saturday)).toBe(true);
  });

  it("v kalendáři ukáže víkend, ne celou sezonu", () => {
    expect(planOnDay("2026-10-17", "2026-10-18", "2026-10-18")).toBe(true);
    expect(planOnDay("2027-03-01", "2027-05-31", "2027-04-15")).toBe(false);
    expect(planOnDay("2026-10-20", null, "2026-10-20")).toBe(true);
  });

  it("pojmenuje uložené rozmezí", () => {
    expect(planLabel("2027-03-01", "2027-05-31", saturday)).toBe("jaro");
    expect(planLabel("2026-10-17", "2026-10-18", saturday)).toBe("víkend");
    expect(planLabel(saturday, "2027-01-17", saturday)).toBe("do 17. 1. 2027");
    expect(planLabel("2026-10-20", null, saturday)).toBe("20. 10.");
  });
});
