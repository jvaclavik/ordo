import { describe, expect, it } from "vitest";
import { dueChoices, formatDay } from "./dates.ts";

function at(day: string, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(`${day}T00:00:00`);
  date.setHours(hour ?? 0, minute ?? 0, 0, 0);
  return date;
}

describe("termíny", () => {
  it("ve středu nabídne běžné dny", () => {
    const labels = dueChoices("2026-10-14", at("2026-10-14", "10:00")).map(
      (choice) => `${choice.label} ${choice.day}${choice.time ? ` ${choice.time}` : ""}`
    );
    expect(labels).toEqual([
      "dnes 2026-10-14",
      "později dnes 2026-10-14 18:00",
      "zítra 2026-10-15",
      "pozítří 2026-10-16",
      "o víkendu 2026-10-17",
      "příští týden 2026-10-19",
    ]);
  });

  it("večer posune později dnes a v noci ji schová", () => {
    expect(dueChoices("2026-10-14", at("2026-10-14", "17:30")).find((choice) => choice.id === "later")?.time).toBe(
      "21:00"
    );
    expect(dueChoices("2026-10-17", at("2026-10-17", "23:28")).some((choice) => choice.id === "later")).toBe(
      false
    );
  });

  it("blízké dny píše slovem", () => {
    const today = "2026-10-18";
    expect(formatDay("2026-10-16", today)).toBe("předevčírem");
    expect(formatDay("2026-10-17", today)).toBe("včera");
    expect(formatDay("2026-10-18", today)).toBe("dnes");
    expect(formatDay("2026-10-19", today)).toBe("zítra");
    expect(formatDay("2026-10-20", today)).toBe("pozítří");
    expect(formatDay("2026-10-21", today)).toBe("21. 10.");
  });

  it("v sobotu nezdvojuje zítřek a příští týden", () => {
    const labels = dueChoices("2026-10-17", at("2026-10-17", "23:28")).map((choice) => choice.label);
    expect(labels).toEqual(["dnes", "zítra", "pozítří", "příští víkend"]);
  });
});