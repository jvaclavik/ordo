// Two-way sync between Ordo tasks and the dedicated "Ordo" Google calendar.
// Pure planning only: given the Ordo database, what this device last saw in
// Google (mirrors) and what both sides last agreed on (bases), decide which
// writes to make. src/data/gcalPush.ts performs them.
//
// Rules:
// - A task with a due date or a plan has one event. Done tasks keep it with a
//   check mark, cancelled, deleted or undated tasks lose it.
// - Title and timing sync both ways. Description, done mark and priority color
//   are owned by Ordo and only flow to Google.
// - When only one side changed since the last agreement, that side wins. When
//   both changed, or this device never saw them agree, the newer edit wins.
// - Deleting the event in Google moves the task to the Ordo trash.
import { addDays, dateKey, dueDateKey, dueTime } from "../domain/dates.ts";
import { byId, statusMeaning } from "../domain/db.ts";
import type { Db, Item, ItemPatch, Priority } from "../domain/types.ts";
import { MANAGED_MARK } from "./gcalEvents.ts";

export const SYNC_MARK = MANAGED_MARK;
export const CALENDAR_NAME = "Ordo";
export const CALENDAR_DESCRIPTION = `Úkoly z aplikace Ordo. Změny názvu a termínu se propisují zpátky do Ordo, smazání přesune úkol do koše. (${SYNC_MARK})`;
export const DEFAULT_MINUTES = 30;
const CREATE_BACK_DAYS = 30;
const DONE_MARK = "✓ ";

export type Slot =
  | { kind: "day"; start: string; last: string }
  | { kind: "time"; day: string; time: string };

export type Content = { title: string; slot: Slot };

export type Extras = { done: boolean; colorId: string | null; body: string };

export type Base = { content: Content } & Extras;

export type Mirror = {
  eventId: string;
  ordoId: string | null;
  cancelled: boolean;
  updated: string;
  summary: string;
  description: string;
  colorId: string | null;
  slot: Slot | null;
  minutes: number | null;
};

export type ApiTime = { date?: string | null; dateTime?: string | null; timeZone?: string | null };

export type ApiSyncEvent = {
  id?: string;
  status?: string;
  updated?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  start?: ApiTime;
  end?: ApiTime;
  extendedProperties?: { private?: Record<string, string> };
};

export type Action =
  | { kind: "create"; itemId: string }
  | { kind: "update"; itemId: string; eventId: string }
  | { kind: "delete"; eventId: string; itemId: string | null }
  | { kind: "pull"; itemId: string; patch: ItemPatch; base: Base }
  | { kind: "trash"; itemId: string }
  | { kind: "agree"; itemId: string }
  | { kind: "forget"; itemId: string };

function hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

// Google event ids allow only 0-9 and a-v. Hex fits, and a fixed id per task
// lets every device write the same event instead of creating duplicates.
export function eventIdFor(itemId: string): string {
  return `ordo${hex(itemId)}`;
}

export function itemIdFromEventId(eventId: string): string | null {
  if (!/^ordo([0-9a-f]{2})+$/.test(eventId)) return null;
  const pairs = eventId.slice(4).match(/../g) ?? [];
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)))
    );
  } catch {
    return null;
  }
}

export function slotOfItem(item: Item): Slot | null {
  const due = dueDateKey(item.dueAt);
  if (due) {
    const time = dueTime(item.dueAt, item.dueHasTime);
    return time ? { kind: "time", day: due, time } : { kind: "day", start: due, last: due };
  }
  if (!item.plannedFor) return null;
  const last =
    item.planUntil && item.planUntil > item.plannedFor ? item.planUntil : item.plannedFor;
  return { kind: "day", start: item.plannedFor, last };
}

function sameSlot(left: Slot | null, right: Slot | null): boolean {
  if (!left || !right) return left === right;
  if (left.kind === "time" && right.kind === "time")
    return left.day === right.day && left.time === right.time;
  if (left.kind === "day" && right.kind === "day")
    return left.start === right.start && left.last === right.last;
  return false;
}

export function sameContent(left: Content | null, right: Content | null): boolean {
  if (!left || !right) return left === right;
  return left.title === right.title && sameSlot(left.slot, right.slot);
}

export function isDone(db: Db, item: Item): boolean {
  return statusMeaning(db, item.statusId) === "done";
}

export function colorFor(priority: Priority | null): string | null {
  if (priority === "urgent") return "11";
  if (priority === "high") return "6";
  return null;
}

// Archived folders keep their events on purpose: unarchiving does not touch
// the items, so a removal there could later be mistaken for a Google delete.
export function belongsInCalendar(db: Db, item: Item): boolean {
  if (item.isDeleted || item.isArchived || item.type !== "task") return false;
  if (byId(db.folders, item.folderId)?.isDeleted) return false;
  if (statusMeaning(db, item.statusId) === "cancelled") return false;
  return slotOfItem(item) !== null;
}

export function contentOfItem(item: Item): Content | null {
  const slot = slotOfItem(item);
  if (!slot) return null;
  return { title: item.title.trim(), slot };
}

export function extrasOfItem(db: Db, item: Item): Extras {
  return { done: isDone(db, item), colorId: colorFor(item.priority), body: item.body ?? "" };
}

export function baseOf(db: Db, item: Item): Base | null {
  const content = contentOfItem(item);
  return content ? { content, ...extrasOfItem(db, item) } : null;
}

function stripDone(summary: string): string {
  return summary.startsWith(DONE_MARK) ? summary.slice(DONE_MARK.length) : summary;
}

export function contentOfMirror(mirror: Mirror): Content | null {
  if (!mirror.slot) return null;
  return { title: stripDone(mirror.summary).trim(), slot: mirror.slot };
}

function extrasOfMirror(mirror: Mirror): Extras {
  return {
    done: mirror.summary.startsWith(DONE_MARK),
    colorId: mirror.colorId,
    body: mirror.description,
  };
}

function sameExtras(left: Extras, right: Extras): boolean {
  return left.done === right.done && left.colorId === right.colorId && left.body === right.body;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function mirrorFromApi(raw: ApiSyncEvent, previous: Mirror | null): Mirror | null {
  if (!raw.id) return null;
  const ordoId =
    raw.extendedProperties?.private?.ordoId ?? previous?.ordoId ?? itemIdFromEventId(raw.id);
  const updated = raw.updated ?? previous?.updated ?? new Date(0).toISOString();
  if (raw.status === "cancelled")
    return {
      eventId: raw.id,
      ordoId,
      cancelled: true,
      updated,
      summary: previous?.summary ?? "",
      description: previous?.description ?? "",
      colorId: previous?.colorId ?? null,
      slot: previous?.slot ?? null,
      minutes: previous?.minutes ?? null,
    };
  let slot: Slot | null = null;
  let minutes: number | null = null;
  if (raw.start?.date) {
    const start = raw.start.date.slice(0, 10);
    const end = raw.end?.date ? addDays(raw.end.date.slice(0, 10), -1) : start;
    slot = { kind: "day", start, last: end > start ? end : start };
  } else if (raw.start?.dateTime) {
    const start = new Date(raw.start.dateTime);
    if (!Number.isNaN(start.getTime())) {
      slot = { kind: "time", day: dateKey(start), time: clock(start) };
      const end = raw.end?.dateTime ? new Date(raw.end.dateTime) : null;
      if (end && !Number.isNaN(end.getTime()) && end > start)
        minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    }
  }
  return {
    eventId: raw.id,
    ordoId,
    cancelled: false,
    updated,
    summary: raw.summary ?? "",
    description: raw.description ?? "",
    colorId: raw.colorId ?? null,
    slot,
    minutes,
  };
}

function localStamp(day: string, time: string, plusMinutes = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, hours ?? 0, (minutes ?? 0) + plusMinutes);
  return `${dateKey(at)}T${clock(at)}:00`;
}

// The body of an insert or patch. Nulls clear the other time variant when an
// event switches between all-day and timed under patch semantics.
export function eventPayload(
  db: Db,
  item: Item,
  options: { timeZone: string; minutes: number | null; create: boolean; origin: string | null }
): Record<string, unknown> | null {
  const content = contentOfItem(item);
  if (!content) return null;
  const extras = extrasOfItem(db, item);
  const slot = content.slot;
  const timing =
    slot.kind === "day"
      ? {
          start: { date: slot.start, dateTime: null, timeZone: null },
          end: { date: addDays(slot.last, 1), dateTime: null, timeZone: null },
        }
      : {
          start: { dateTime: localStamp(slot.day, slot.time), timeZone: options.timeZone, date: null },
          end: {
            dateTime: localStamp(slot.day, slot.time, options.minutes ?? DEFAULT_MINUTES),
            timeZone: options.timeZone,
            date: null,
          },
        };
  const payload: Record<string, unknown> = {
    summary: `${extras.done ? DONE_MARK : ""}${content.title}`,
    description: extras.body,
    colorId: extras.colorId,
    status: "confirmed",
    ...timing,
    extendedProperties: { private: { ordoId: item.id } },
  };
  if (options.create) {
    payload.id = eventIdFor(item.id);
    payload.transparency = "transparent";
    if (options.origin?.startsWith("http")) payload.source = { title: CALENDAR_NAME, url: options.origin };
    if (payload.colorId === null) delete payload.colorId;
    const start = payload.start as Record<string, unknown>;
    const end = payload.end as Record<string, unknown>;
    for (const edge of [start, end])
      for (const key of Object.keys(edge)) if (edge[key] === null) delete edge[key];
  }
  return payload;
}

// How a Google-side change becomes an Ordo patch. Ordo keeps due and plan
// exclusive, and a single day keeps whichever role the task already had.
export function pullPatch(item: Item, google: Content): ItemPatch {
  const patch: ItemPatch = {};
  if (google.title && google.title !== item.title.trim()) patch.title = google.title;
  const current = slotOfItem(item);
  if (sameSlot(current, google.slot)) return patch;
  const slot = google.slot;
  if (slot.kind === "time") {
    patch.dueAt = `${slot.day}T${slot.time}`;
    patch.dueHasTime = true;
    return patch;
  }
  if (slot.start === slot.last && item.dueAt) {
    patch.dueAt = slot.start;
    patch.dueHasTime = false;
    return patch;
  }
  patch.plannedFor = slot.start;
  patch.planUntil = slot.last > slot.start ? slot.last : null;
  return patch;
}

function newer(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}

export function planSync(input: {
  db: Db;
  mirrors: Record<string, Mirror>;
  bases: Record<string, Base>;
  tombstones: Record<string, number>;
  today: string;
}): Action[] {
  const { db, mirrors, bases, tombstones, today } = input;
  const actions: Action[] = [];
  const byOrdoId = new Map<string, Mirror>();
  for (const mirror of Object.values(mirrors)) {
    if (!mirror.ordoId) continue;
    const known = byOrdoId.get(mirror.ordoId);
    if (!known || mirror.eventId === eventIdFor(mirror.ordoId)) byOrdoId.set(mirror.ordoId, mirror);
  }
  const fresh = db.items.length === 0;
  for (const item of db.items) {
    const mirror = byOrdoId.get(item.id) ?? null;
    byOrdoId.delete(item.id);
    const base = bases[item.id] ?? null;
    if (!belongsInCalendar(db, item)) {
      if (mirror && !mirror.cancelled)
        actions.push({ kind: "delete", eventId: mirror.eventId, itemId: item.id });
      else if (base) actions.push({ kind: "forget", itemId: item.id });
      continue;
    }
    const ordo = contentOfItem(item);
    if (!ordo) continue;
    const extras = extrasOfItem(db, item);
    if (!mirror) {
      const slot = ordo.slot;
      const lastDay = slot.kind === "day" ? slot.last : slot.day;
      const recent = lastDay >= addDays(today, -CREATE_BACK_DAYS);
      if (base || recent || !extras.done) actions.push({ kind: "create", itemId: item.id });
      continue;
    }
    if (mirror.cancelled) {
      const ours = tombstones[mirror.eventId] !== undefined;
      const untouched = !base || sameContent(base.content, ordo);
      if (!ours && untouched && newer(mirror.updated, item.updatedAt))
        actions.push({ kind: "trash", itemId: item.id });
      else actions.push({ kind: "update", itemId: item.id, eventId: mirror.eventId });
      continue;
    }
    const google = contentOfMirror(mirror);
    const extrasMoved = base ? !sameExtras(base, extras) : !sameExtras(extrasOfMirror(mirror), extras);
    if (sameContent(ordo, google)) {
      if (extrasMoved) actions.push({ kind: "update", itemId: item.id, eventId: mirror.eventId });
      else if (!base || !sameContent(base.content, ordo) || !sameExtras(base, extras))
        actions.push({ kind: "agree", itemId: item.id });
      continue;
    }
    // After a pull both sides hold Google's content. The Ordo-owned extras
    // keep their last agreed value, so a pending Ordo change still goes out.
    const pull = (): Action | null =>
      google
        ? {
            kind: "pull",
            itemId: item.id,
            patch: pullPatch(item, google),
            base: {
              content: google,
              ...(base
                ? { done: base.done, colorId: base.colorId, body: base.body }
                : extrasOfMirror(mirror)),
            },
          }
        : null;
    const push: Action = { kind: "update", itemId: item.id, eventId: mirror.eventId };
    let chosen: Action | null;
    if (base && sameContent(base.content, google)) chosen = push;
    else if (base && sameContent(base.content, ordo)) chosen = pull();
    else chosen = newer(mirror.updated, item.updatedAt) ? pull() : push;
    actions.push(chosen ?? push);
  }
  if (fresh) return actions;
  for (const [ordoId, mirror] of byOrdoId) {
    if (mirror.cancelled || !bases[ordoId]) continue;
    actions.push({ kind: "delete", eventId: mirror.eventId, itemId: ordoId });
  }
  return actions;
}
