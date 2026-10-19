import { describe, expect, it } from "vitest";
import { mergeSpoken } from "./dictate.tsx";

describe("diktování", () => {
  it("připojí namluvené za to, co už v poli je", () => {
    expect(mergeSpoken("", "koupit mléko zítra")).toBe("koupit mléko zítra");
    expect(mergeSpoken("koupit", "mléko zítra")).toBe("koupit mléko zítra");
    expect(mergeSpoken("koupit ", "  mléko  ")).toBe("koupit mléko");
    expect(mergeSpoken("koupit mléko", "   ")).toBe("koupit mléko");
  });
});
