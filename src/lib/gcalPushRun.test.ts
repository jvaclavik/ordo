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
import type { Ctx, Db } from "../domain/types.ts";
import { eventIdFor, type ApiSyncEvent } from "./gcalPush.ts";
import {
  emptyPushState,
  syncOnce,
  type PushDeps,
  type PushState,
} from "./gcalPushRun.ts";
import { GoogleError, type GoogleApi } from "./googleErrors.ts";

const TODAY = "2026-10-16";

type Stored = ApiSyncEvent & { version: number };

function merge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (typeof value === "object" && !Array.isArray(value)) {
      const inner =
        typeof target[key] === "object" && target[key] !== null
          ? (target[key] as Record<string, unknown>)
          : {};
      target[key] = merge({ ...inner }, value as Record<string, unknown>);
    } else target[key] = value;
  }
  return target;
}

// Just enough of Google Calendar: owned calendars, events with patch
// semantics, soft deletes and incremental sync tokens.
class FakeGoogle {
  clock = Date.parse("2026-10-16T09:00:00.000Z");
  calendars = new Map<
    string,
    { description: string; events: Map<string, Stored> }
  >();
  version = 0;
  writes = 0;
  created = 0;

  stamp(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  touch(event: Stored) {
    event.updated = this.stamp();
    this.version += 1;
    event.version = this.version;
  }

  only(): Map<string, Stored> {
    const [first] = this.calendars.values();
    if (!first) throw new Error("no calendar");
    return first.events;
  }

  event(itemId: string): Stored {
    const found = this.only().get(eventIdFor(itemId));
    if (!found) throw new Error(`no event for ${itemId}`);
    return found;
  }

  userEdit(itemId: string, patch: Record<string, unknown>) {
    const event = this.event(itemId);
    merge(event as unknown as Record<string, unknown>, patch);
    this.touch(event);
  }

  userDelete(itemId: string) {
    const event = this.event(itemId);
    event.status = "cancelled";
    this.touch(event);
  }

  api: GoogleApi = async <T>(
    method: string,
    path: string,
    options: { params?: Record<string, string>; body?: unknown } = {}
  ): Promise<T> => {
    const body = (options.body ?? {}) as Record<string, unknown>;
    if (path === "/users/me/calendarList")
      return {
        items: [...this.calendars].map(([id, calendar]) => ({
          id,
          description: calendar.description,
        })),
      } as T;
    if (path === "/calendars" && method === "POST") {
      this.created += 1;
      const id = `cal${this.created}`;
      this.calendars.set(id, {
        description: String(body.description ?? ""),
        events: new Map(),
      });
      return { id } as T;
    }
    const match = path.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    const calendar = match
      ? this.calendars.get(decodeURIComponent(match[1] ?? ""))
      : undefined;
    if (!match || !calendar) throw new GoogleError(404, false);
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;
    if (method === "GET") {
      const since = Number(options.params?.syncToken ?? -1);
      const items = [...calendar.events.values()]
        .filter((event) => event.version > since)
        .map(({ version: _, ...event }) => structuredClone(event));
      return { items, nextSyncToken: String(this.version) } as T;
    }
    this.writes += 1;
    if (method === "POST") {
      const id = String(body.id);
      if (calendar.events.has(id)) throw new GoogleError(409, false);
      const event = {
        ...structuredClone(body),
        status: "confirmed",
        version: 0,
      } as Stored;
      this.touch(event);
      calendar.events.set(id, event);
      return structuredClone(event) as T;
    }
    const existing = eventId ? calendar.events.get(eventId) : undefined;
    if (!existing) throw new GoogleError(404, false);
    if (method === "PATCH")
      merge(
        existing as unknown as Record<string, unknown>,
        structuredClone(body)
      );
    if (method === "DELETE") existing.status = "cancelled";
    this.touch(existing);
    return (method === "DELETE" ? null : structuredClone(existing)) as T;
  };
}

function setup() {
  const google = new FakeGoogle();
  const ctx = (): Ctx => ({
    now: new Date(google.clock).toISOString(),
    today: TODAY,
    id: () => `id${Math.random().toString(36).slice(2, 8)}`,
  });
  let db: Db = freshDb({ ...ctx(), now: "2026-10-16T08:00:00.000Z" });
  const inbox = inboxFolder(db);
  if (!inbox) throw new Error("no inbox");
  const open = resolvedOpen(db, inbox)?.id ?? null;
  const done = resolvedClosed(db, inbox)?.id ?? "";
  for (const item of [
    newItem({
      id: "dentist",
      folderId: inbox.id,
      title: "Zubař",
      statusId: open,
      dueAt: "2026-10-20T09:00",
      dueHasTime: true,
    }),
    newItem({
      id: "trip",
      folderId: inbox.id,
      title: "Chata",
      statusId: open,
      plannedFor: "2026-10-23",
      planUntil: "2026-10-25",
    }),
    newItem({
      id: "someday",
      folderId: inbox.id,
      title: "Jednou",
      statusId: open,
    }),
  ])
    db = reduce(
      db,
      { type: "createItem", item },
      { ...ctx(), now: "2026-10-16T08:00:00.000Z" }
    );
  const edit = (op: Op) => {
    google.stamp();
    db = reduce(db, op, ctx());
  };
  const device = (state: PushState = emptyPushState(true)) => {
    const deps = (allowTrash: boolean): PushDeps => ({
      api: google.api,
      getDb: () => db,
      dispatch: (op) => {
        db = reduce(db, op, ctx());
      },
      timeZone: "Europe/Prague",
      origin: "https://ordo.example",
      today: TODAY,
      allowTrash,
      now: () => google.clock,
    });
    return {
      state,
      sync: (allowTrash = true) => syncOnce(state, deps(allowTrash)),
    };
  };
  return {
    google,
    edit,
    device,
    inboxId: inbox.id,
    done,
    get db() {
      return db;
    },
    set db(next: Db) {
      db = next;
    },
  };
}

async function settles(
  run: () => Promise<unknown>,
  google: FakeGoogle,
  db: () => Db
) {
  const writes = google.writes;
  const before = db();
  await run();
  expect(google.writes).toBe(writes);
  expect(db()).toBe(before);
}

describe("Google Calendar sync against a fake Google", () => {
  it("creates the Ordo calendar, fills it once and then stays quiet", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    expect(world.google.calendars.size).toBe(1);
    expect([...world.google.only().keys()].sort()).toEqual(
      [eventIdFor("dentist"), eventIdFor("trip")].sort()
    );
    expect(world.google.event("trip").start).toEqual({ date: "2026-10-23" });
    expect(world.google.event("trip").end).toEqual({ date: "2026-10-26" });
    await settles(phone.sync, world.google, () => world.db);
  });

  it("pushes Ordo edits, including a switch from timed to all-day", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    world.edit({
      type: "updateItem",
      id: "dentist",
      patch: { title: "Zubař Praha", dueAt: "2026-10-21", dueHasTime: false },
    });
    await phone.sync();
    const event = world.google.event("dentist");
    expect(event.summary).toBe("Zubař Praha");
    expect(event.start).toEqual({ date: "2026-10-21" });
    expect(event.end).toEqual({ date: "2026-10-22" });
    await settles(phone.sync, world.google, () => world.db);
  });

  it("pulls a rename and a move done in Google back into the task", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    world.google.userEdit("dentist", {
      summary: "Zubař, vzít kartičku",
      start: { dateTime: "2026-10-22T14:30:00", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-10-22T15:15:00", timeZone: "Europe/Prague" },
    });
    await phone.sync();
    const task = byId(world.db.items, "dentist");
    expect(task?.title).toBe("Zubař, vzít kartičku");
    expect(task?.dueAt).toBe("2026-10-22T14:30");
    expect(task?.dueHasTime).toBe(true);
    await settles(phone.sync, world.google, () => world.db);
    world.edit({
      type: "updateItem",
      id: "dentist",
      patch: { dueAt: "2026-10-23T08:00" },
    });
    await phone.sync();
    expect(world.google.event("dentist").end?.dateTime).toBe(
      "2026-10-23T08:45:00"
    );
  });

  it("marks done tasks and removes deleted ones", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    world.edit({
      type: "placeItem",
      id: "dentist",
      folderId: world.inboxId,
      statusId: world.done,
      sortOrder: "a0",
    });
    world.edit({ type: "deleteItem", id: "trip" });
    await phone.sync();
    expect(world.google.event("dentist").summary).toBe("✓ Zubař");
    expect(world.google.event("trip").status).toBe("cancelled");
    await settles(phone.sync, world.google, () => world.db);
  });

  it("moves a task to the trash when its event is deleted in Google, once trash is allowed", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    world.google.userDelete("trip");
    await phone.sync(false);
    expect(byId(world.db.items, "trip")?.isDeleted).toBe(false);
    await phone.sync(true);
    expect(byId(world.db.items, "trip")?.isDeleted).toBe(true);
    await settles(phone.sync, world.google, () => world.db);
  });

  it("brings an undone delete back instead of trashing the task", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    const before = world.db;
    world.edit({ type: "deleteItem", id: "trip" });
    await phone.sync();
    world.db = before;
    await phone.sync();
    expect(byId(world.db.items, "trip")?.isDeleted).toBe(false);
    expect(world.google.event("trip").status).toBe("confirmed");
  });

  it("recreates the calendar when it was deleted in Google, without trashing tasks", async () => {
    const world = setup();
    const phone = world.device();
    await phone.sync();
    world.google.calendars.clear();
    await phone.sync();
    expect(world.google.calendars.size).toBe(1);
    expect(world.google.only().size).toBe(2);
    expect(world.db.items.every((item) => !item.isDeleted)).toBe(true);
  });

  it("lets a second device join without rewriting anything", async () => {
    const world = setup();
    await world.device().sync();
    const laptop = world.device();
    await settles(laptop.sync, world.google, () => world.db);
    expect(laptop.state.calendarId).toBe("cal1");
    world.edit({
      type: "updateItem",
      id: "trip",
      patch: { title: "Chata u Lipna" },
    });
    await laptop.sync();
    expect(world.google.event("trip").summary).toBe("Chata u Lipna");
  });

  it("writes reminder days for a long plan and drops the later ones when it is done", async () => {
    const world = setup();
    const open = byId(world.db.items, "dentist")?.statusId ?? null;
    world.edit({
      type: "createItem",
      item: newItem({
        id: "gift",
        folderId: world.inboxId,
        title: "Dárek",
        statusId: open,
        plannedFor: "2026-10-01",
        planUntil: "2026-12-31",
      }),
    });
    const phone = world.device();
    await phone.sync();
    const days = reminderDays("2026-10-01", "2026-12-31", null).filter(
      (day) => day >= TODAY
    );
    for (const day of days) {
      const event = world.google.only().get(eventIdFor("gift", day));
      expect(event?.status).toBe("confirmed");
      expect(event?.summary).toBe(
        day === "2026-12-31" ? "Poslední připomínka: Dárek" : "Dárek"
      );
    }
    expect(world.google.only().has(eventIdFor("gift"))).toBe(false);
    world.edit({
      type: "placeItem",
      id: "gift",
      folderId: world.inboxId,
      statusId: world.done,
      sortOrder: "a0",
    });
    await phone.sync();
    for (const day of days.filter((day) => day > TODAY))
      expect(world.google.only().get(eventIdFor("gift", day))?.status).toBe(
        "cancelled"
      );
    await settles(phone.sync, world.google, () => world.db);
  });

  it("raises an open long plan to urgent on its last day", async () => {
    const world = setup();
    const open = byId(world.db.items, "dentist")?.statusId ?? null;
    world.edit({
      type: "createItem",
      item: newItem({
        id: "last",
        folderId: world.inboxId,
        title: "Uzavřít",
        statusId: open,
        plannedFor: "2026-09-01",
        planUntil: TODAY,
      }),
    });
    await world.device().sync();
    expect(byId(world.db.items, "last")?.priority).toBe("urgent");
    const event = world.google.only().get(eventIdFor("last", TODAY));
    expect(event?.summary).toBe("Poslední připomínka: Uzavřít");
    expect(event?.colorId).toBe("11");
    const reminders = [...world.google.only().keys()].filter((id) =>
      id.startsWith(eventIdFor("last"))
    );
    expect(reminders).toEqual([eventIdFor("last", TODAY)]);
  });
});
