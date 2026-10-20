import { describe, expect, it } from "vitest";
import { isUntouched } from "../data/syncMap.ts";
import { byId } from "./db.ts";
import { demoOps } from "./demo.ts";
import { freshDb, reduce } from "./reduce.ts";
import { suggestFolders } from "./select.ts";
import type { Ctx } from "./types.ts";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-20T08:00:00.000Z",
    today: "2026-10-20",
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

describe("ukázková data", () => {
  it("naplní prázdnou aplikaci tím, co umí", () => {
    const base = ctx();
    const start = freshDb(base);
    const inbox = start.folders[0]!;
    expect(isUntouched(start)).toBe(true);
    const db = demoOps("2026-10-20", inbox.id).reduce(
      (next, op) => reduce(next, op, base),
      start
    );
    expect(isUntouched(db)).toBe(false);
    expect(byId(db.folders, "demo-prace")?.defaultView).toBe("board");
    expect(byId(db.folders, "demo-cesty")?.defaultView).toBe("calendar");
    expect(byId(db.folders, "demo-recko")?.parentId).toBe("demo-cesty");
    expect(byId(db.items, "demo-letenky")?.folderId).toBe("demo-recko");
    expect(byId(db.folders, "demo-napady")?.defaultView).toBe("notes");
    expect(byId(db.items, "demo-zapis")?.recurrenceFreq).toBe("weekly");
    expect(byId(db.items, "demo-zapis")?.assigneeId).toBe("demo-jana");
    expect(byId(db.items, "demo-napad")?.type).toBe("note");
    expect(byId(db.items, "demo-cislo")?.parentItemId).toBe("demo-elektrikar");
    expect(byId(db.items, "demo-pytle")?.folderId).toBe(inbox.id);
    expect(db.dependencies.some((row) => row.itemId === "demo-nabidka")).toBe(
      true
    );
    expect(db.rules.some((rule) => rule.matchText === "pojišťovna")).toBe(true);
    expect(
      suggestFolders(db, "Objednat pytle").some(
        (folder) => folder.id === "demo-doma"
      )
    ).toBe(true);
    expect(
      suggestFolders(db, "Koupit mléko").map((folder) => folder.id)
    ).toEqual(["demo-doma"]);
  });
});
