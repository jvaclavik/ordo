import { describe, expect, it } from "vitest";
import { byId } from "./db.ts";
import { newItem } from "./factory.ts";
import { freshDb, reduce } from "./reduce.ts";
import type { Ctx, Db, Priority } from "./types.ts";

function ctx(now = "2026-10-16T08:00:00.000Z"): Ctx {
  let count = 0;
  return {
    now,
    today: "2026-10-16",
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

function task(db: Db, id: string, priority: Priority | null, now: string): Db {
  const folder = db.folders[0]!;
  const status = db.statuses.find((entry) => entry.meaning === "todo")!;
  return reduce(
    db,
    { type: "createItem", item: newItem({ id, folderId: folder.id, title: id, statusId: status.id, priority }) },
    ctx(now),
  );
}

function titles(db: Db): string[] {
  const status = db.statuses.find((entry) => entry.meaning === "todo")!;
  return db.items
    .filter((item) => !item.isDeleted && item.statusId === status.id && item.type === "task")
    .sort((left, right) => (left.sortOrder < right.sortOrder ? -1 : left.sortOrder > right.sortOrder ? 1 : 0))
    .map((item) => item.title);
}

describe("řazení položek", () => {
  it("seřadí podle priority a nová položka se vloží na své místo", () => {
    let db = freshDb(ctx());
    db = task(db, "bezna", null, "2026-10-16T08:00:00.000Z");
    db = task(db, "nizka", "low", "2026-10-16T08:01:00.000Z");
    db = task(db, "urgentni", "urgent", "2026-10-16T08:02:00.000Z");
    const folder = db.folders[0]!;
    db = reduce(db, { type: "updateFolder", id: folder.id, patch: { itemSort: "priority" } }, ctx());
    expect(byId(db.folders, folder.id)?.itemSort).toBe("priority");
    expect(titles(db)).toEqual(["urgentni", "bezna", "nizka"]);

    db = task(db, "vysoka", "high", "2026-10-16T08:03:00.000Z");
    expect(byId(db.folders, folder.id)?.itemSort).toBe("priority");
    expect(titles(db)).toEqual(["urgentni", "vysoka", "bezna", "nizka"]);

    const bezna = db.items.find((item) => item.title === "bezna")!;
    db = reduce(db, { type: "updateItem", id: bezna.id, patch: { priority: "urgent" } }, ctx());
    expect(byId(db.folders, folder.id)?.itemSort).toBe("priority");
    expect(titles(db)).toEqual(["urgentni", "bezna", "vysoka", "nizka"]);
  });

  it("nejnovější je nahoře a ruční posun řazení vypne", () => {
    let db = freshDb(ctx());
    db = task(db, "starsi", null, "2026-10-16T08:00:00.000Z");
    db = task(db, "novejsi", null, "2026-10-16T09:00:00.000Z");
    const folder = db.folders[0]!;
    const status = db.statuses.find((entry) => entry.meaning === "todo")!;
    db = reduce(db, { type: "updateFolder", id: folder.id, patch: { itemSort: "created" } }, ctx());
    expect(titles(db)).toEqual(["novejsi", "starsi"]);

    db = task(db, "nejnovejsi", null, "2026-10-16T10:00:00.000Z");
    expect(titles(db)).toEqual(["nejnovejsi", "novejsi", "starsi"]);

    const newest = db.items.find((item) => item.title === "nejnovejsi")!;
    const older = db.items.find((item) => item.title === "novejsi")!;
    db = reduce(
      db,
      { type: "placeItem", id: newest.id, folderId: folder.id, statusId: status.id, sortOrder: "z", manual: true },
      ctx(),
    );
    expect(byId(db.folders, folder.id)?.itemSort).toBeNull();
    expect(byId(db.items, newest.id)?.sortOrder).toBe("z");
    const kept = byId(db.items, older.id);
    expect(kept !== null && kept.sortOrder < "z").toBe(true);
  });

  it("dokončení při zapnutém řazení položku zařadí a režim nechá", () => {
    let db = freshDb(ctx());
    db = task(db, "prvni", "low", "2026-10-16T08:00:00.000Z");
    db = task(db, "druha", "urgent", "2026-10-16T08:01:00.000Z");
    const folder = db.folders[0]!;
    const done = db.statuses.find((entry) => entry.meaning === "done")!;
    db = reduce(db, { type: "updateFolder", id: folder.id, patch: { itemSort: "priority" } }, ctx());
    const first = db.items.find((item) => item.title === "prvni")!;
    db = reduce(
      db,
      { type: "placeItem", id: first.id, folderId: folder.id, statusId: done.id, sortOrder: "z" },
      ctx(),
    );
    expect(byId(db.folders, folder.id)?.itemSort).toBe("priority");
    expect(byId(db.items, first.id)?.statusId).toBe(done.id);
    expect(byId(db.items, first.id)?.sortOrder).not.toBe("z");
  });
});
