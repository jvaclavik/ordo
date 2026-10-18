import { describe, expect, it } from "vitest";
import { addMonths, nextWeekday } from "./dates.ts";
import { byId, resolvedClosed, resolvedOpen } from "./db.ts";
import { newItem } from "./factory.ts";
import {
  hashAtCaret,
  opsFromQuickAdd,
  opsFromTaskLines,
  parseQuickAdd,
  slashAtCaret,
  slashQueryExact,
  suggestSlashFolders,
  suggestTags,
  tagQueryExact,
  tokenAtCaret,
} from "./quickAdd.ts";
import { nextOccurrence } from "./recurrence.ts";
import { freshDb, reduce } from "./reduce.ts";
import { inboxWaitingCount, isChecked } from "./select.ts";
import { fold } from "./text.ts";
import type { Ctx, Db } from "./types.ts";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-16T08:00:00.000Z",
    today: "2026-10-16",
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

const today = "2026-10-16";

function run(db: Db, ops: Parameters<typeof reduce>[1][], base = ctx()): Db {
  return ops.reduce((next, op) => reduce(next, op, base), db);
}

describe("text a data", () => {
  it("odstraní diakritiku", () => {
    expect(fold("Příští týden")).toBe("pristi tyden");
  });

  it("počítá dny v týdnu a měsíce", () => {
    expect(nextWeekday(today, 5)).toBe(today);
    expect(nextWeekday(today, 1)).toBe("2026-10-19");
    expect(nextWeekday(today, 4)).toBe("2026-10-22");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("rychlé přidání", () => {
  it("rozdělí název a popis a vytáhne vlastnosti", () => {
    const base = ctx();
    let db = freshDb(base);
    db = reduce(
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
    const parsed = parseQuickAdd(
      "Zavolat elektrikáři zítra /Dům !vysoká #telefon @Honza v 18:00\nještě poznámka",
      db,
      today
    );
    expect(parsed.title).toBe("Zavolat elektrikáři");
    expect(parsed.body).toBe("ještě poznámka");
    expect(parsed.dueDay).toBe("2026-10-17");
    expect(parsed.dueTime).toBe("18:00");
    expect(parsed.priority).toBe("high");
    expect(parsed.folderId).toBe("dum");
    expect(parsed.tagNames).toEqual(["telefon"]);
    expect(parsed.personNames).toEqual(["Honza"]);
  });

  it("našeptá složku podle lomítka", () => {
    const base = ctx();
    let db = freshDb(base);
    db = reduce(
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
    db = reduce(
      db,
      {
        type: "createFolder",
        id: "kuch",
        parentId: "dum",
        name: "Kuchyně",
        icon: null,
        color: null,
        statusIds: { todo: "t2", doing: "d2", done: "h2" },
      },
      base
    );
    const line = "mléko /du";
    expect(slashAtCaret(line, line.length)?.query).toBe("du");
    expect(suggestSlashFolders(db, "du").map((folder) => folder.id)).toContain(
      "dum"
    );
    expect(
      suggestSlashFolders(db, "kuch").find((folder) => folder.id === "kuch")
        ?.token
    ).toBe("/Dům/Kuchyně");
    expect(slashAtCaret("mléko /Dům/Ku", "mléko /Dům/Ku".length)?.query).toBe(
      "Dům/Ku"
    );
    expect(slashQueryExact(db, "Dům")).toBe(true);
    expect(slashQueryExact(db, "du")).toBe(false);
    expect(
      parseQuickAdd("návod https://example.com/dum", db, today).title
    ).toBe("návod https://example.com/dum");
    expect(
      parseQuickAdd("návod https://example.com/dum", db, today).folderId
    ).toBeNull();
    expect(
      slashAtCaret("mléko /du\npopis", "mléko /du\npopis".length)
    ).toBeNull();
    const second = "první\n/Du";
    expect(slashAtCaret(second, second.length)?.query).toBe("Du");
  });

  it("našeptá tag po mřížce", () => {
    let db = freshDb(ctx());
    const base = ctx();
    db = reduce(
      db,
      { type: "ensureTag", id: "nakup", name: "nákup", color: null },
      base
    );
    db = reduce(
      db,
      { type: "ensureTag", id: "tel", name: "telefon", color: null },
      base
    );
    const line = "koupit #na";
    expect(hashAtCaret(line, line.length)?.query).toBe("na");
    expect(suggestTags(db, "na").map((tag) => tag.name)).toEqual(["nákup"]);
    expect(suggestTags(db, "").map((tag) => tag.name)).toEqual([
      "nákup",
      "telefon",
    ]);
    expect(tagQueryExact(db, "nákup")).toBe(true);
    expect(tagQueryExact(db, "na")).toBe(false);
    expect(hashAtCaret("koupit #nákup ", "koupit #nákup ".length)).toBeNull();
    expect(hashAtCaret("C#", 2)).toBeNull();
    const mixed = "volat /Dům #te";
    expect(tokenAtCaret(mixed, mixed.length)?.kind).toBe("tag");
    expect(tokenAtCaret("volat #tel /Du", "volat #tel /Du".length)?.kind).toBe(
      "folder"
    );
  });

  it("nechá samotný název na jednom řádku", () => {
    const db = freshDb(ctx());
    const parsed = parseQuickAdd("Koupit mléko", db, today);
    expect(parsed.title).toBe("Koupit mléko");
    expect(parsed.body).toBeNull();
  });

  it("rozumí českým datům", () => {
    const db = freshDb(ctx());
    expect(parseQuickAdd("úkol pozítří", db, today).dueDay).toBe("2026-10-18");
    expect(parseQuickAdd("úkol za 3 dny", db, today).dueDay).toBe("2026-10-19");
    expect(parseQuickAdd("úkol pátek", db, today).dueDay).toBe(today);
    expect(parseQuickAdd("úkol 15.11.", db, today).dueDay).toBe("2026-11-15");
    expect(parseQuickAdd("úkol 15.1.", db, today).dueDay).toBe("2027-01-15");
    expect(parseQuickAdd("úkol příští týden", db, today).dueDay).toBe(
      "2026-10-23"
    );
    expect(parseQuickAdd("úkol příští týden", db, today).planFrom).toBeNull();
    expect(parseQuickAdd("úkol dneska", db, today).dueDay).toBe(today);
    expect(parseQuickAdd("úkol zejtra", db, today).dueDay).toBe("2026-10-17");
  });

  it("z hlasu vezme čas, složku i štítek a vymaže je z názvu", () => {
    const base = ctx();
    let db = freshDb(base);
    db = reduce(
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
    db = reduce(
      db,
      {
        type: "createFolder",
        id: "kuch",
        parentId: "dum",
        name: "Kuchyně",
        icon: null,
        color: null,
        statusIds: { todo: "t2", doing: "d2", done: "h2" },
      },
      base
    );
    const spoken = parseQuickAdd(
      "zavolat sklenářovi dnes v 9 hod složka Dům hashtag bourání",
      db,
      today
    );
    expect(spoken.title).toBe("zavolat sklenářovi");
    expect(spoken.dueDay).toBe(today);
    expect(spoken.dueTime).toBe("09:00");
    expect(spoken.folderId).toBe("dum");
    expect(spoken.tagNames).toEqual(["bourání"]);

    expect(
      parseQuickAdd("zavolat sklenářovi dneska ve 9:00", db, today).dueTime
    ).toBe("09:00");
    expect(parseQuickAdd("zavolat sklenářovi 9h", db, today).dueTime).toBe(
      "09:00"
    );
    expect(
      parseQuickAdd("zavolat sklenářovi v devět hodin", db, today)
    ).toMatchObject({ title: "zavolat sklenářovi", dueTime: "09:00" });
    expect(parseQuickAdd("v 9 dnech zavolat", db, today).dueTime).toBeNull();

    const kitchen = parseQuickAdd("kategorie Kuchyně umýt okno", db, today);
    expect(kitchen.folderId).toBe("kuch");
    expect(kitchen.title).toBe("umýt okno");
    const nested = parseQuickAdd("do složky Dům Kuchyně umýt okno", db, today);
    expect(nested.folderId).toBe("kuch");
    expect(nested.title).toBe("umýt okno");
    expect(
      parseQuickAdd("složka nikam zavolat", db, today).folderId
    ).toBeNull();
    expect(parseQuickAdd("složka nikam zavolat", db, today).title).toBe(
      "složka nikam zavolat"
    );

    const tagged = parseQuickAdd("štítek bourání zbořit zeď", db, today);
    expect(tagged.tagNames).toEqual(["bourání"]);
    expect(tagged.title).toBe("zbořit zeď");
    db = reduce(
      db,
      { type: "ensureTag", id: "bour", name: "bourání", color: null },
      base
    );
    expect(
      parseQuickAdd("hashtagem bourani zbořit zeď", db, today).tagNames
    ).toEqual(["bourání"]);
  });

  it("pozná období jako plán a nechá termín být", () => {
    const db = freshDb(ctx());
    const spring = parseQuickAdd("vysadit javor na jaře", db, today);
    expect(spring.title).toBe("vysadit javor");
    expect(spring.planFrom).toBe("2027-03-01");
    expect(spring.planUntil).toBe("2027-05-31");
    expect(spring.dueDay).toBeNull();
    const months = parseQuickAdd("koupit beton do třech měsíců", db, today);
    expect(months.title).toBe("koupit beton");
    expect(months.planFrom).toBe(today);
    expect(months.planUntil).toBe("2027-01-16");
    expect(months.chips.find((chip) => chip.kind === "horizon")?.label).toBe(
      "do 3 měsíců"
    );
    const weekend = parseQuickAdd("vypnout topení na víkend", db, "2026-10-17");
    expect(weekend.title).toBe("vypnout topení");
    expect(weekend.planFrom).toBe("2026-10-17");
    expect(weekend.planUntil).toBe("2026-10-18");
    const next = parseQuickAdd("úkol na příští týden", db, today);
    expect(next.title).toBe("úkol");
    expect(next.dueDay).toBeNull();
    expect(next.planFrom).toBe("2026-10-19");
    expect(next.planUntil).toBe("2026-10-25");
    const soon = parseQuickAdd("úkol za 3 dny", db, today);
    expect(soon.dueDay).toBe("2026-10-19");
    expect(soon.planFrom).toBeNull();
    const inbox = db.folders[0]!;
    const saved = run(db, [
      ...opsFromQuickAdd(db, months, {
        folderId: inbox.id,
        statusId: null,
        dateRole: "due",
        applyRules: false,
        itemId: "beton",
        ids: () => "tag",
      }),
    ]);
    expect(byId(saved.items, "beton")?.plannedFor).toBe(today);
    expect(byId(saved.items, "beton")?.planUntil).toBe("2027-01-16");
    expect(byId(saved.items, "beton")?.dueAt).toBeNull();
  });
});

describe("opakování", () => {
  it("posune denní lék o den a neprodukuje zmeškané", () => {
    expect(
      nextOccurrence(today, {
        freq: "daily",
        interval: 1,
        weekdays: [],
        until: null,
      })
    ).toBe("2026-10-17");
    expect(
      nextOccurrence(today, {
        freq: "weekly",
        interval: 1,
        weekdays: [1, 5],
        until: null,
      })
    ).toBe("2026-10-19");
  });

  it("dokončení založí další výskyt a odškrtnutí ho vezme zpět", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    const open = resolvedOpen(db, inbox)!;
    const closed = resolvedClosed(db, inbox)!;
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "lek",
          folderId: inbox.id,
          title: "Brát si lék",
          statusId: open.id,
        }),
      },
      base
    );
    db = reduce(
      db,
      {
        type: "setRecurrence",
        itemId: "lek",
        freq: "daily",
        interval: 1,
        weekdays: null,
        until: null,
      },
      base
    );
    db = reduce(
      db,
      {
        type: "placeItem",
        id: "lek",
        folderId: inbox.id,
        statusId: closed.id,
        sortOrder: "b",
      },
      base
    );
    const openOnes = db.items.filter(
      (item) => !item.isDeleted && item.recurrenceFreq === "daily"
    );
    expect(openOnes).toHaveLength(1);
    expect(openOnes[0]?.plannedFor).toBe("2026-10-17");
    expect(openOnes[0]?.pristine).toBe(true);
    expect(byId(db.items, "lek")?.recurrenceFreq).toBeNull();
    expect(isChecked(db, byId(db.items, "lek")!)).toBe(true);
    db = reduce(
      db,
      {
        type: "placeItem",
        id: "lek",
        folderId: inbox.id,
        statusId: open.id,
        sortOrder: "a",
      },
      base
    );
    expect(db.items.filter((item) => !item.isDeleted)).toHaveLength(1);
    expect(byId(db.items, "lek")?.recurrenceFreq).toBe("daily");
  });
});

describe("pravidla a vazby", () => {
  it("zařadí nezařazené podle pravidla", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    db = reduce(
      db,
      {
        type: "createFolder",
        id: "zdravi",
        parentId: null,
        name: "Zdraví",
        icon: null,
        color: null,
        statusIds: { todo: "zt", doing: "zd", done: "zh" },
      },
      base
    );
    db = reduce(
      db,
      {
        type: "createRule",
        id: "rule",
        matchText: "lék",
        matchTagId: null,
        actionFolderId: "zdravi",
        actionStatusId: null,
        actionTagId: null,
      },
      base
    );
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "lek",
          folderId: inbox.id,
          title: "Brát lék",
          applyRules: true,
        }),
      },
      base
    );
    expect(byId(db.items, "lek")?.folderId).toBe("zdravi");
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "hned",
          folderId: inbox.id,
          title: "Koupit lék",
        }),
      },
      base
    );
    expect(byId(db.items, "hned")?.folderId).toBe("zdravi");
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "cekajici",
          folderId: inbox.id,
          title: "Poznámka",
          applyRules: false,
        }),
      },
      base
    );
    expect(byId(db.items, "cekajici")?.folderId).toBe(inbox.id);
    expect(inboxWaitingCount(db)).toBe(1);
    db = reduce(
      db,
      {
        type: "updateItem",
        id: "cekajici",
        patch: { title: "Koupit lék" },
      },
      base
    );
    expect(byId(db.items, "cekajici")?.folderId).toBe(inbox.id);
    db = reduce(
      db,
      {
        type: "updateItem",
        id: "cekajici",
        patch: {},
        fileInbox: true,
      },
      base
    );
    expect(byId(db.items, "cekajici")?.folderId).toBe("zdravi");
    expect(inboxWaitingCount(db)).toBe(0);
  });

  it("zařadí čekající hned při uložení pravidla i štítku", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    db = reduce(
      db,
      {
        type: "createFolder",
        id: "dum",
        parentId: null,
        name: "Dům",
        icon: null,
        color: null,
        statusIds: { todo: "dt", doing: "dd", done: "dh" },
      },
      base
    );
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "mleko",
          folderId: inbox.id,
          title: "Koupit mléko",
          applyRules: false,
        }),
      },
      base
    );
    expect(byId(db.items, "mleko")?.folderId).toBe(inbox.id);
    db = reduce(
      db,
      {
        type: "createRule",
        id: "rule",
        matchText: "mléko",
        matchTagId: null,
        actionFolderId: "dum",
        actionStatusId: null,
        actionTagId: null,
      },
      base
    );
    expect(byId(db.items, "mleko")?.folderId).toBe("dum");
    db = reduce(
      db,
      { type: "ensureTag", id: "tag", name: "nákup", color: null },
      base
    );
    db = reduce(
      db,
      {
        type: "createItem",
        item: newItem({
          id: "cek",
          folderId: inbox.id,
          title: "Ještě něco",
          applyRules: false,
        }),
      },
      base
    );
    db = reduce(
      db,
      {
        type: "createRule",
        id: "tag-rule",
        matchText: null,
        matchTagId: "tag",
        actionFolderId: "dum",
        actionStatusId: null,
        actionTagId: null,
      },
      base
    );
    expect(byId(db.items, "cek")?.folderId).toBe(inbox.id);
    db = reduce(
      db,
      { type: "setItemTags", itemId: "cek", tagIds: ["tag"] },
      base
    );
    expect(byId(db.items, "cek")?.folderId).toBe("dum");
  });

  it("odmítne cyklus závislosti i složky", () => {
    const base = ctx();
    let db = freshDb(base);
    const inbox = db.folders[0]!;
    db = run(
      db,
      [
        {
          type: "createItem",
          item: newItem({ id: "a", folderId: inbox.id, title: "A" }),
        },
        {
          type: "createItem",
          item: newItem({ id: "b", folderId: inbox.id, title: "B" }),
        },
        { type: "addDependency", id: "d1", itemId: "a", dependsOnId: "b" },
        { type: "addDependency", id: "d2", itemId: "b", dependsOnId: "a" },
      ],
      base
    );
    expect(db.dependencies.filter((row) => !row.isDeleted)).toHaveLength(1);
    db = run(
      db,
      [
        {
          type: "createFolder",
          id: "parent",
          parentId: null,
          name: "Rodič",
          icon: null,
          color: null,
          statusIds: { todo: "p1", doing: "p2", done: "p3" },
        },
        {
          type: "createFolder",
          id: "child",
          parentId: "parent",
          name: "Dítě",
          icon: null,
          color: null,
          statusIds: { todo: "c1", doing: "c2", done: "c3" },
        },
        { type: "moveFolder", id: "parent", parentId: "child", sortOrder: "z" },
      ],
      base
    );
    expect(byId(db.folders, "parent")?.parentId).toBeNull();
  });
});

describe("úkol na řádek", () => {
  it("z každého řádku udělá úkol a popis neukládá", () => {
    const base = ctx();
    const db = freshDb(base);
    const inbox = db.folders[0]!;
    const { ops, itemIds } = opsFromTaskLines(
      db,
      "Koupit chleba\n\nZavolat #telefon\nNapsat #telefon",
      {
        folderId: inbox.id,
        statusId: null,
        dateRole: "due",
        applyRules: false,
        ids: base.id,
        today,
      }
    );
    const next = ops.reduce((state, op) => reduce(state, op, base), db);
    expect(itemIds).toHaveLength(3);
    const titles = itemIds.map((id) => byId(next.items, id)?.title);
    expect(titles).toEqual(["Koupit chleba", "Zavolat", "Napsat"]);
    expect(itemIds.every((id) => byId(next.items, id)?.body == null)).toBe(
      true
    );
    expect(next.tags.filter((tag) => tag.name === "telefon")).toHaveLength(1);
    const orders = itemIds.map((id) => byId(next.items, id)?.sortOrder ?? "");
    expect(orders[0]! < orders[1]!).toBe(true);
    expect(orders[1]! < orders[2]!).toBe(true);
  });
});

describe("sestavení úkolu z parseru", () => {
  it("uloží první osobu a štítek", () => {
    const base = ctx();
    const db = freshDb(base);
    const inbox = db.folders[0]!;
    const parsed = parseQuickAdd("Zavolat @Honza #telefon", db, today);
    const ops = opsFromQuickAdd(db, parsed, {
      folderId: inbox.id,
      statusId: null,
      dateRole: "due",
      applyRules: false,
      itemId: "item",
      ids: base.id,
    });
    const next = ops.reduce((state, op) => reduce(state, op, base), db);
    const item = byId(next.items, "item");
    expect(item?.title).toBe("Zavolat");
    expect(item?.assigneeId).toBeTruthy();
    expect(next.tags.map((tag) => tag.name)).toContain("telefon");
    expect(next.people.map((person) => person.name)).toContain("Honza");
  });
});
