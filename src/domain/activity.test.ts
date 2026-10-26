import { describe, expect, it } from "vitest";
import { recordActivity } from "./activity.ts";
import { inboxFolder, resolvedClosed } from "./db.ts";
import { newItem } from "./factory.ts";
import { freshDb, reduce } from "./reduce.ts";
import type { Ctx, Db } from "./types.ts";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-25T08:41:00.000Z",
    today: "2026-10-25",
    id: () => {
      count += 1;
      return `a${count}`;
    },
  };
}

function run(db: Db, op: Parameters<typeof reduce>[1], base: Ctx): Db {
  return reduce(db, op, base);
}

describe("záznamy aktivity", () => {
  it("zapíše novou poznámku a přesun do složky, pin ani pohled ne", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = inboxFolder(db);
    expect(inbox).not.toBeNull();
    db = run(
      db,
      {
        type: "createFolder",
        id: "dum",
        parentId: null,
        name: "Dům",
        icon: null,
        color: null,
        statusIds: { todo: "t", doing: "d", done: "h" },
      },
      base
    );
    const create = {
      type: "createItem" as const,
      item: newItem({
        id: "note",
        folderId: inbox!.id,
        title: "Nákup",
        type: "note",
        sortOrder: "a",
      }),
    };
    expect(recordActivity(db, create, base).map((entry) => entry.text)).toEqual([
      "Nová poznámka „Nákup“",
    ]);
    db = run(db, create, base);
    const move = {
      type: "placeItem" as const,
      id: "note",
      folderId: "dum",
      statusId: "t",
      sortOrder: "b",
    };
    const filed = recordActivity(db, {
      type: "batch",
      ops: [
        move,
        { type: "updateItem", id: "note", patch: { pinX: null, pinY: null, pinZ: null } },
      ],
    }, base);
    expect(filed.map((entry) => entry.text)).toEqual([
      "Poznámka „Nákup“ je ve složce Dům",
    ]);
    expect(filed[0]?.target).toEqual({ kind: "item", id: "note" });
    db = run(db, move, base);
    expect(
      recordActivity(db, {
        type: "updateItem",
        id: "note",
        patch: { pinX: 12, pinY: 40, pinZ: 2 },
      }, base)
    ).toEqual([]);
    expect(
      recordActivity(db, {
        type: "updateFolder",
        id: "dum",
        patch: { defaultView: "notes" },
      }, base)
    ).toEqual([]);
  });

  it("zapíše splnění úkolu", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = inboxFolder(db)!;
    const closed = resolvedClosed(db, inbox);
    expect(closed).not.toBeNull();
    db = run(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "task",
          folderId: inbox.id,
          title: "Zavolat",
          sortOrder: "a",
        }),
      },
      base
    );
    const done = recordActivity(
      db,
      {
        type: "placeItem",
        id: "task",
        folderId: inbox.id,
        statusId: closed!.id,
        sortOrder: "b",
      },
      base
    );
    expect(done.map((entry) => entry.text)).toEqual(["Úkol „Zavolat“ je hotový"]);
  });

  it("uloží barvu, prioritu a velikost poznámky", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = inboxFolder(db);
    expect(inbox).not.toBeNull();
    db = run(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "note",
          folderId: inbox!.id,
          title: "Nákup",
          type: "note",
          sortOrder: "a",
          paper: 2,
          priority: "urgent",
          pinW: 300,
          pinH: 220,
        }),
      },
      base
    );
    const note = db.items.find((item) => item.id === "note");
    expect(note?.paper).toBe(2);
    expect(note?.priority).toBe("urgent");
    expect(note?.pinW).toBe(300);
    expect(note?.pinH).toBe(220);
    expect(
      recordActivity(
        db,
        { type: "updateItem", id: "note", patch: { title: "Nákup mléka" } },
        base
      ).map((entry) => entry.text)
    ).toEqual(["Poznámka se jmenuje „Nákup mléka“"]);
    expect(
      recordActivity(db, { type: "updateItem", id: "note", patch: { paper: 4 } }, base).map(
        (entry) => entry.text
      )
    ).toEqual(["Barva „Nákup“ je růžová"]);
    expect(
      recordActivity(
        db,
        { type: "updateItem", id: "note", patch: { priority: "low" } },
        base
      ).map((entry) => entry.text)
    ).toEqual(["Priorita „Nákup“ je nízká"]);
    expect(
      recordActivity(
        db,
        { type: "updateItem", id: "note", patch: { pinW: 400, pinH: 240 } },
        base
      )
    ).toEqual([]);
  });

  it("uloží poznámku na místo, kam se kartička přesune", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = inboxFolder(db);
    expect(inbox).not.toBeNull();
    db = run(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "note",
          folderId: inbox!.id,
          title: "Poznámka",
          type: "note",
          sortOrder: "a",
          pinX: 48,
          pinY: 96,
          pinZ: 2,
        }),
      },
      base
    );
    const note = db.items.find((item) => item.id === "note");
    expect(note?.pinX).toBe(48);
    expect(note?.pinY).toBe(96);
    expect(note?.pinZ).toBe(2);
    expect(recordActivity(db, {
      type: "updateItem",
      id: "note",
      patch: { pinX: 10, pinY: 20, pinZ: 3 },
    }, base)).toEqual([]);
  });
});
