import { describe, expect, it } from "vitest";
import { findClocks } from "./clock.ts";
import { fold } from "./text.ts";

function at(text: string): string | null {
  return findClocks(fold(text))[0]?.time ?? null;
}

describe("čas v zadání", () => {
  it("bere čísla v různých tvarech", () => {
    expect(at("dnes v 9 hod")).toBe("09:00");
    expect(at("dnes v 9 hodin")).toBe("09:00");
    expect(at("dnes v 9h")).toBe("09:00");
    expect(at("dnes 9h")).toBe("09:00");
    expect(at("dnes 9:00")).toBe("09:00");
    expect(at("dnes v 9:00")).toBe("09:00");
    expect(at("dnes 9.00")).toBe("09:00");
    expect(at("ve 21 hodin")).toBe("21:00");
    expect(at("v 9 30")).toBe("09:30");
    expect(at("v 18:00")).toBe("18:00");
    expect(at("o 9. hodině")).toBe("09:00");
    expect(at("kolem 9 hodin")).toBe("09:00");
  });

  it("bere slovní hodiny, jak je řekne hlas", () => {
    expect(at("v devět hodin")).toBe("09:00");
    expect(at("v devíti")).toBe("09:00");
    expect(at("devět hodin")).toBe("09:00");
    expect(at("v devět třicet")).toBe("09:30");
    expect(at("v půl desáté")).toBe("09:30");
    expect(at("půl deset")).toBe("09:30");
    expect(at("čtvrt na deset")).toBe("09:15");
    expect(at("tři čtvrtě na desátou")).toBe("09:45");
    expect(at("v devět večer")).toBe("21:00");
    expect(at("ve tři odpoledne")).toBe("15:00");
    expect(at("v poledne")).toBe("12:00");
    expect(at("o půlnoci")).toBe("00:00");
  });

  it("neplete si čas s délkou", () => {
    expect(at("za 9 hodin")).toBeNull();
    expect(at("v 9 dnech")).toBeNull();
    expect(at("v osmi dnech")).toBeNull();
    expect(at("15.11.")).toBeNull();
  });
});
