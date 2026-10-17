import { describe, expect, it } from "vitest";
import { folderEmoji } from "./emoji.ts";

describe("emoji složky", () => {
  it("vezme poslední emoji a složené znaky nechá pohromadě", () => {
    expect(folderEmoji("🎉")).toBe("🎉");
    expect(folderEmoji("poznámka 🏠 a 🔨")).toBe("🔨");
    expect(folderEmoji("👩‍💻")).toBe("👩‍💻");
    expect(folderEmoji("👍🏻")).toBe("👍🏻");
    expect(folderEmoji("🇨🇿")).toBe("🇨🇿");
    expect(folderEmoji("text")).toBeNull();
    expect(folderEmoji("   ")).toBeNull();
  });
});
