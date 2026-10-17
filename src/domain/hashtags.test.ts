import { describe, expect, it } from "vitest";
import { hashtagOps, pullHashtags, removeToken, taskTextOps } from "./hashtags.ts";
import { byId } from "./db.ts";
import { newItem } from "./factory.ts";
import { freshDb, reduce } from "./reduce.ts";
import type { Ctx } from "./types.ts";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-17T12:00:00.000Z",
    today: "2026-10-17",
    id: () => `id${count++}`,
  };
}

describe("hashtagy v textu", () => {
  it("vytáhne tag a nechá nadpis", () => {
    expect(pullHashtags("Brát lék #okno")).toEqual({
      text: "Brát lék",
      names: ["okno"],
    });
    expect(pullHashtags("#okno")).toEqual({ text: "", names: ["okno"] });
    expect(pullHashtags("a #okno\n# Nadpis")).toEqual({
      text: "a\n# Nadpis",
      names: ["okno"],
    });
    expect(pullHashtags("C#okno").names).toEqual([]);
    expect(pullHashtags("po večeři #okno teď").text).toBe("po večeři teď");
  });

  it("přidá tag k úkolu a známý nezdvojuje", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({ id: "task", folderId: inbox.id, title: "Brát lék" }),
      },
      base
    );
    db = reduce(db, { type: "ensureTag", id: "okno", name: "okno", color: null }, base);
    const ops = hashtagOps(db, "task", ["okno", "Okno", "dveře"], () => "dvere");
    expect(ops.map((op) => op.type)).toEqual(["ensureTag", "setItemTags"]);
    const tagged = ops.reduce((next, op) => reduce(next, op, base), db);
    const again = hashtagOps(tagged, "task", ["okno"], () => "x");
    expect(again).toEqual([]);
  });

  it("vyjme rozepsaný tag z textu", () => {
    expect(removeToken("Brát lék #ok", 9, 12)).toBe("Brát lék");
  });

  it("u poznámky mřížku na tag nemění a prázdný název nemaže", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({ id: "task", folderId: inbox.id, title: "Brát lék" }),
      },
      base
    );
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "note",
          folderId: inbox.id,
          title: "Poznámka",
          type: "note",
        }),
      },
      base
    );
    const task = byId(db.items, "task");
    const note = byId(db.items, "note");
    expect(task && note).toBeTruthy();
    if (!task || !note) return;
    const kept = taskTextOps(db, task, {}, ["okno"], () => "okno");
    expect(kept.some((op) => op.type === "updateItem" && op.patch.title === "")).toBe(false);
    expect(kept.some((op) => op.type === "setItemTags")).toBe(true);
    const noteOps = taskTextOps(db, note, { title: "Poznámka" }, ["okno"], () => "x");
    expect(noteOps).toEqual([]);
  });
});
