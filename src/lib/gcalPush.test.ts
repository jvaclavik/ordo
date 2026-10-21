import { describe, expect, it } from "vitest";
import {
  byId,
  inboxFolder,
  resolvedClosed,
  resolvedOpen,
} from "../domain/db.ts";
import { newItem } from "../domain/factory.ts";
import { reminderDays } from "../domain/horizon.ts";
import type { Op } from "../domain/op.ts";
import { freshDb, reduce } from "../domain/reduce.ts";
import type { Ctx, Db, Item } from "../domain/types.ts";
import {
  baseOf,
  eventIdFor,
  eventPayload,
  itemIdFromEventId,
  mirrorFromApi,
  planSync,
  type ApiSyncEvent,
  type Base,
  type Mirror,
} from "./gcalPush.ts";

const TODAY = "2026-10-16";
const CREATED = "2026-10-16T08:00:00.000Z";

function ctx(now = CREATED): Ctx {
  let count = 0;
  return {
    now,
    today: TODAY,
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

function apply(db: Db, op: Op, now = CREATED): Db {
  return reduce(db, op, ctx(now));
}

function setup(fields: Partial<Parameters<typeof newItem>[0]> = {}) {
  let db = freshDb(ctx());
  const inbox = inboxFolder(db);
  if (!inbox) throw new Error("no inbox");
  db = apply(db, {
    type: "createItem",
    item: newItem({
      id: "task1",
      folderId: inbox.id,
      title: "Zubař",
      statusId: resolvedOpen(db, inbox)?.id ?? null,
      dueAt: "2026-10-20T09:00",
      dueHasTime: true,
      ...fields,
    }),
  });
  return { db, inbox };
}

function item(db: Db, id = "task1"): Item {
  const found = byId(db.items, id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

// What Google returns after Ordo created the event, optionally edited there.
function googleEvent(db: Db, updated: string, edit: ApiSyncEvent = {}): Mirror {
  const payload = eventPayload(db, item(db), {
    timeZone: "Europe/Prague",
    minutes: null,
    create: true,
    origin: null,
  }) as ApiSyncEvent;
  const start = payload.start?.dateTime;
  const end = payload.end?.dateTime;
  const raw: ApiSyncEvent = {
    ...payload,
    ...(start ? { start: { dateTime: new Date(start).toISOString() } } : {}),
    ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}),
    updated,
    ...edit,
  };
  return mirrorFromApi(raw, null) as Mirror;
}

function agreed(db: Db, updated = "2026-10-16T08:00:05.000Z") {
  const mirror = googleEvent(db, updated);
  return {
    mirrors: { [mirror.eventId]: mirror } as Record<string, Mirror>,
    bases: { task1: baseOf(db, item(db)) as Base } as Record<string, Base>,
  };
}

function plan(
  db: Db,
  mirrors: Record<string, Mirror>,
  bases: Record<string, Base>,
  tombstones = {}
) {
  return planSync({ db, mirrors, bases, tombstones, today: TODAY });
}

describe("Google Calendar sync plan", () => {
  it("gives every task a fixed event id that Google accepts and Ordo can read back", () => {
    const id = eventIdFor("aB-_9xYz12");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(itemIdFromEventId(id)).toBe("aB-_9xYz12");
    const dated = eventIdFor("aB-_9xYz12", "2026-10-20");
    expect(dated).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(itemIdFromEventId(dated)).toBe("aB-_9xYz12");
    expect(itemIdFromEventId("someone-else")).toBeNull();
  });

  it("creates events for dated tasks only", () => {
    const { db, inbox } = setup();
    const withOthers = [
      newItem({ id: "undated", folderId: inbox.id, title: "Bez data" }),
      newItem({
        id: "note",
        folderId: inbox.id,
        title: "Poznámka",
        type: "note",
        dueAt: TODAY,
      }),
      newItem({
        id: "plan",
        folderId: inbox.id,
        title: "Chata",
        plannedFor: "2026-10-23",
        planUntil: "2026-10-25",
      }),
    ].reduce(
      (next, entry) => apply(next, { type: "createItem", item: entry }),
      db
    );
    expect(plan(withOthers, {}, {})).toEqual([
      { kind: "create", itemId: "task1" },
      { kind: "create", itemId: "plan" },
    ]);
  });

  it("skips long-finished tasks but still brings old open ones", () => {
    const { db, inbox } = setup({ dueAt: "2026-07-01", dueHasTime: false });
    const closed = resolvedClosed(db, inbox)?.id ?? "";
    const done = apply(db, {
      type: "placeItem",
      id: "task1",
      folderId: inbox.id,
      statusId: closed,
      sortOrder: "a0",
    });
    expect(plan(done, {}, {})).toEqual([]);
    expect(plan(db, {}, {})).toEqual([{ kind: "create", itemId: "task1" }]);
  });

  it("stays quiet once both sides agree", () => {
    const { db } = setup();
    const { mirrors, bases } = agreed(db);
    expect(plan(db, mirrors, bases)).toEqual([]);
    expect(plan(db, mirrors, {})).toEqual([{ kind: "agree", itemId: "task1" }]);
  });

  it("pushes a rename or a new date made in Ordo", () => {
    const { db } = setup();
    const { mirrors, bases } = agreed(db);
    const renamed = apply(
      db,
      { type: "updateItem", id: "task1", patch: { title: "Zubař Praha" } },
      "2026-10-17T10:00:00.000Z"
    );
    expect(plan(renamed, mirrors, bases)).toEqual([
      { kind: "update", itemId: "task1", eventId: eventIdFor("task1") },
    ]);
    const moved = apply(
      db,
      { type: "updateItem", id: "task1", patch: { dueAt: "2026-10-21T09:00" } },
      "2026-10-17T10:00:00.000Z"
    );
    expect(plan(moved, mirrors, bases)[0]?.kind).toBe("update");
  });

  it("pulls a rename and a move made in Google into the task", () => {
    const { db } = setup();
    const { bases } = agreed(db);
    const local = new Date(2026, 9, 22, 14, 30);
    const edited = googleEvent(db, "2026-10-17T10:00:00.000Z", {
      summary: "Zubař, vzít kartičku",
      start: { dateTime: local.toISOString() },
      end: { dateTime: new Date(local.getTime() + 45 * 60_000).toISOString() },
    });
    const actions = plan(db, { [edited.eventId]: edited }, bases);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "pull",
      itemId: "task1",
      patch: {
        title: "Zubař, vzít kartičku",
        dueAt: "2026-10-22T14:30",
        dueHasTime: true,
      },
    });
    expect(edited.minutes).toBe(45);
  });

  it("turns a dragged all-day span back into an Ordo plan", () => {
    const { db } = setup({
      dueAt: null,
      dueHasTime: false,
      plannedFor: "2026-10-23",
      planUntil: null,
    });
    const { bases } = agreed(db);
    const edited = googleEvent(db, "2026-10-17T10:00:00.000Z", {
      start: { date: "2026-10-24" },
      end: { date: "2026-10-27" },
    });
    expect(plan(db, { [edited.eventId]: edited }, bases)[0]).toMatchObject({
      kind: "pull",
      patch: { plannedFor: "2026-10-24", planUntil: "2026-10-26" },
    });
  });

  it("lets the newer edit win when both sides changed", () => {
    const { db } = setup();
    const { bases } = agreed(db);
    const renamed = apply(
      db,
      { type: "updateItem", id: "task1", patch: { title: "Ordo název" } },
      "2026-10-17T10:00:00.000Z"
    );
    const googleLater = googleEvent(db, "2026-10-17T11:00:00.000Z", {
      summary: "Google název",
    });
    expect(
      plan(renamed, { [googleLater.eventId]: googleLater }, bases)[0]?.kind
    ).toBe("pull");
    const googleEarlier = googleEvent(db, "2026-10-17T09:00:00.000Z", {
      summary: "Google název",
    });
    expect(
      plan(renamed, { [googleEarlier.eventId]: googleEarlier }, bases)[0]?.kind
    ).toBe("update");
  });

  it("removes the event when the task is deleted, cancelled or loses its date", () => {
    const { db, inbox } = setup();
    const { mirrors, bases } = agreed(db);
    const remove = [
      { kind: "delete", eventId: eventIdFor("task1"), itemId: "task1" },
    ];
    expect(
      plan(apply(db, { type: "deleteItem", id: "task1" }), mirrors, bases)
    ).toEqual(remove);
    expect(
      plan(
        apply(db, {
          type: "updateItem",
          id: "task1",
          patch: { dueAt: null, dueHasTime: false },
        }),
        mirrors,
        bases
      )
    ).toEqual(remove);
    const withCancel = apply(db, {
      type: "createStatus",
      id: "cx",
      folderId: inbox.id,
      name: "Zrušeno",
      meaning: "cancelled",
    });
    const cancelled = apply(withCancel, {
      type: "placeItem",
      id: "task1",
      folderId: inbox.id,
      statusId: "cx",
      sortOrder: "a0",
    });
    expect(plan(cancelled, mirrors, bases)).toEqual(remove);
  });

  it("marks finished tasks instead of removing them", () => {
    const { db, inbox } = setup();
    const { mirrors, bases } = agreed(db);
    const closed = resolvedClosed(db, inbox)?.id ?? "";
    const done = apply(
      db,
      {
        type: "placeItem",
        id: "task1",
        folderId: inbox.id,
        statusId: closed,
        sortOrder: "a0",
      },
      "2026-10-17T10:00:00.000Z"
    );
    expect(plan(done, mirrors, bases)).toEqual([
      { kind: "update", itemId: "task1", eventId: eventIdFor("task1") },
    ]);
    const payload = eventPayload(done, item(done), {
      timeZone: "Europe/Prague",
      minutes: null,
      create: false,
      origin: null,
    });
    expect(payload?.summary).toBe("✓ Zubař");
  });

  it("moves the task to trash when its event is deleted in Google", () => {
    const { db } = setup();
    const { bases } = agreed(db);
    const deleted = mirrorFromApi(
      {
        id: eventIdFor("task1"),
        status: "cancelled",
        updated: "2026-10-17T10:00:00.000Z",
      },
      googleEvent(db, "2026-10-16T08:00:05.000Z")
    ) as Mirror;
    const mirrors = { [deleted.eventId]: deleted };
    expect(plan(db, mirrors, bases)).toEqual([
      { kind: "trash", itemId: "task1" },
    ]);
    expect(plan(db, mirrors, bases, { [deleted.eventId]: 1 })[0]?.kind).toBe(
      "update"
    );
    const editedLater = apply(
      db,
      { type: "updateItem", id: "task1", patch: { title: "Ještě platí" } },
      "2026-10-18T10:00:00.000Z"
    );
    expect(plan(editedLater, mirrors, bases)[0]?.kind).toBe("update");
  });

  it("deletes events of purged tasks it knew about, never on an empty database", () => {
    const { db } = setup();
    const { mirrors, bases } = agreed(db);
    const purged = apply(apply(db, { type: "deleteItem", id: "task1" }), {
      type: "purgeItem",
      id: "task1",
    });
    const withOther = apply(purged, {
      type: "createItem",
      item: newItem({
        id: "other",
        folderId: inboxFolder(purged)?.id ?? "",
        title: "Jiný",
      }),
    });
    expect(plan(withOther, mirrors, bases)).toEqual([
      { kind: "delete", eventId: eventIdFor("task1"), itemId: "task1" },
    ]);
    expect(plan(withOther, mirrors, {})).toEqual([]);
    expect(plan({ ...withOther, items: [] }, mirrors, bases)).toEqual([]);
  });

  it("keeps a timed event's length and clears the other time form on patch", () => {
    const { db } = setup();
    const timed = eventPayload(db, item(db), {
      timeZone: "Europe/Prague",
      minutes: 90,
      create: false,
      origin: null,
    });
    expect(timed?.start).toEqual({
      dateTime: "2026-10-20T09:00:00",
      timeZone: "Europe/Prague",
      date: null,
    });
    expect(timed?.end).toEqual({
      dateTime: "2026-10-20T10:30:00",
      timeZone: "Europe/Prague",
      date: null,
    });
    const allDay = apply(db, {
      type: "updateItem",
      id: "task1",
      patch: { dueAt: "2026-10-20", dueHasTime: false },
    });
    const created = eventPayload(allDay, item(allDay), {
      timeZone: "Europe/Prague",
      minutes: null,
      create: true,
      origin: "https://ordo.example",
    });
    expect(created?.start).toEqual({ date: "2026-10-20" });
    expect(created?.end).toEqual({ date: "2026-10-21" });
    expect(created?.id).toBe(eventIdFor("task1"));
    expect(created?.transparency).toBe("transparent");
  });

  it("splits a long plan into reminders and names the last one", () => {
    const from = "2026-10-01";
    const until = "2026-12-31";
    const { db } = setup({
      dueAt: null,
      dueHasTime: false,
      title: "Dárek",
      plannedFor: from,
      planUntil: until,
      priority: "high",
    });
    const days = reminderDays(from, until, "high").filter(
      (day) => day >= TODAY
    );
    const actions = plan(db, {}, {});
    expect(actions).toEqual(
      days.map((day) => ({
        kind: "create",
        itemId: "task1",
        eventId: eventIdFor("task1", day),
      }))
    );
    const last = eventPayload(db, item(db), {
      timeZone: "Europe/Prague",
      minutes: null,
      create: true,
      origin: null,
      eventId: eventIdFor("task1", until),
    });
    const middle = days.find((day) => day !== until);
    const earlier = eventPayload(db, item(db), {
      timeZone: "Europe/Prague",
      minutes: null,
      create: true,
      origin: null,
      ...(middle ? { eventId: eventIdFor("task1", middle) } : {}),
    });
    expect(last?.summary).toBe("Poslední připomínka: Dárek");
    expect(last?.start).toEqual({ date: until });
    expect(earlier?.summary).toBe("Dárek");
    expect(String(last?.id)).toMatch(/^[0-9a-v]+$/);
  });

  it("drops future reminders once the task is done and ignores the last-day prefix", () => {
    const from = "2026-10-01";
    const until = "2026-12-31";
    const { db, inbox } = setup({
      dueAt: null,
      dueHasTime: false,
      title: "Dárek",
      plannedFor: from,
      planUntil: until,
    });
    const days = reminderDays(from, until, null).filter((day) => day >= TODAY);
    const mirrors: Record<string, Mirror> = {};
    for (const day of days) {
      const payload = eventPayload(db, item(db), {
        timeZone: "Europe/Prague",
        minutes: null,
        create: true,
        origin: null,
        eventId: eventIdFor("task1", day),
      }) as ApiSyncEvent;
      const mirror = mirrorFromApi(
        { ...payload, updated: "2026-10-16T08:00:05.000Z" },
        null
      );
      if (mirror) mirrors[mirror.eventId] = mirror;
    }
    const bases = { task1: baseOf(db, item(db)) as Base };
    expect(plan(db, mirrors, bases)).toEqual([]);
    const closed = resolvedClosed(db, inbox)?.id ?? "";
    const done = apply(db, {
      type: "placeItem",
      id: "task1",
      folderId: inbox.id,
      statusId: closed,
      sortOrder: "a0",
    });
    const next = plan(done, mirrors, bases);
    const future = days.filter((day) => day > TODAY);
    expect(
      next
        .filter((action) => action.kind === "delete")
        .map((action) => action.eventId)
        .sort()
    ).toEqual(future.map((day) => eventIdFor("task1", day)).sort());
    expect(next.some((action) => action.kind === "trash")).toBe(false);
    const kept = days.filter((day) => day <= TODAY);
    expect(
      next
        .filter((action) => action.kind === "update")
        .map((action) => action.eventId)
        .sort()
    ).toEqual(kept.map((day) => eventIdFor("task1", day)).sort());
  });

  it("turns one dragged reminder into that day without taking its prefix as the title", () => {
    const from = "2026-10-01";
    const until = "2026-12-31";
    const { db } = setup({
      dueAt: null,
      dueHasTime: false,
      title: "Dárek",
      plannedFor: from,
      planUntil: until,
    });
    const payload = eventPayload(db, item(db), {
      timeZone: "Europe/Prague",
      minutes: null,
      create: true,
      origin: null,
      eventId: eventIdFor("task1", until),
    }) as ApiSyncEvent;
    const dragged = mirrorFromApi(
      {
        ...payload,
        updated: "2026-10-17T10:00:00.000Z",
        start: { date: "2026-11-02" },
        end: { date: "2026-11-03" },
      },
      null
    );
    if (!dragged) throw new Error("no mirror");
    const actions = plan(
      db,
      { [dragged.eventId]: dragged },
      { task1: baseOf(db, item(db)) as Base }
    );
    expect(actions[0]).toMatchObject({
      kind: "pull",
      patch: { plannedFor: "2026-11-02", planUntil: null },
    });
    expect(
      actions[0]?.kind === "pull" ? actions[0].patch.title : "set"
    ).toBeUndefined();
  });
});
