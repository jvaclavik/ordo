// Two-way sync between Ordo tasks and the dedicated "Ordo" Google calendar.
// Pure planning only: given the Ordo database, what this device last saw in
// Google (mirrors) and what both sides last agreed on (bases), decide which
// writes to make. src/data/gcalPush.ts performs them.
//
// Rules:
// - A due date, or a plan of at most seven days, is one event. A longer plan
//   is a few one-day reminders (more when the priority is higher), always
//   including the last day. Done tasks keep today's reminder with a check
//   mark; later reminders are deleted. Cancelled, deleted or undated tasks
//   lose every event.
// - Title and timing sync both ways. Description, the done mark, the last
//   reminder's prefix and the priority color are owned by Ordo.
// - When only one side changed since the last agreement, that side wins. When
//   both changed, or this device never saw them agree, the newer edit wins.
// - Deleting the event in Google moves the task to the Ordo trash.
import { addDays, dateKey, dueDateKey, dueTime } from "../domain/dates.ts";
import { byId, statusMeaning } from "../domain/db.ts";
import { isLongPlan, planEnd, reminderDays } from "../domain/horizon.ts";
import type { Db, Item, ItemPatch, Priority } from "../domain/types.ts";
import { MANAGED_MARK } from "./gcalEvents.ts";

export const SYNC_MARK = MANAGED_MARK;
export const CALENDAR_NAME = "Ordo";
export const CALENDAR_DESCRIPTION = `Úkoly z aplikace Ordo. Změny názvu a termínu se propisují zpátky do Ordo, smazání přesune úkol do koše. (${SYNC_MARK})`;
export const DEFAULT_MINUTES = 30;
const CREATE_BACK_DAYS = 30;
const DONE_MARK = "✓ ";
const LAST_MARK = "Poslední připomínka: ";

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

export type ApiTime = {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
};

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
  | { kind: "create"; itemId: string; eventId?: string }
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

// Google event ids allow only 0-9 and a-v. Hex fits. A due date or a short
// plan uses one id per task. Each reminder of a longer plan adds the day,
// with "v" as a separator because hex never contains it.
export function eventIdFor(itemId: string, day?: string): string {
  const id = `ordo${hex(itemId)}`;
  return day ? `${id}v${day.replaceAll("-", "")}` : id;
}

export function itemIdFromEventId(eventId: string): string | null {
  const core = eventId.replace(/v\d{8}$/, "");
  if (!/^ordo([0-9a-f]{2})+$/.test(core)) return null;
  const pairs = core.slice(4).match(/../g) ?? [];
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
    return time
      ? { kind: "time", day: due, time }
      : { kind: "day", start: due, last: due };
  }
  if (!item.plannedFor) return null;
  const last =
    item.planUntil && item.planUntil > item.plannedFor
      ? item.planUntil
      : item.plannedFor;
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

export function sameContent(
  left: Content | null,
  right: Content | null
): boolean {
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
  return {
    done: isDone(db, item),
    colorId: colorFor(item.priority),
    body: item.body ?? "",
  };
}

export function baseOf(db: Db, item: Item): Base | null {
  const content = contentOfItem(item);
  return content ? { content, ...extrasOfItem(db, item) } : null;
}

function stripDone(summary: string): string {
  return summary.startsWith(DONE_MARK)
    ? summary.slice(DONE_MARK.length)
    : summary;
}

function plainTitle(summary: string): string {
  const bare = stripDone(summary).trim();
  return bare.startsWith(LAST_MARK)
    ? bare.slice(LAST_MARK.length).trim()
    : bare;
}

function dayFromEventId(eventId: string): string | null {
  const match = /v(\d{4})(\d{2})(\d{2})$/.exec(eventId);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function usesReminders(item: Item): boolean {
  return !item.dueAt && isLongPlan(item.plannedFor, item.planUntil);
}

export function contentOfMirror(mirror: Mirror): Content | null {
  if (!mirror.slot) return null;
  return { title: plainTitle(mirror.summary), slot: mirror.slot };
}

function extrasOfMirror(mirror: Mirror): Extras {
  return {
    done: mirror.summary.startsWith(DONE_MARK),
    colorId: mirror.colorId,
    body: mirror.description,
  };
}

function sameExtras(left: Extras, right: Extras): boolean {
  return (
    left.done === right.done &&
    left.colorId === right.colorId &&
    left.body === right.body
  );
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function mirrorFromApi(
  raw: ApiSyncEvent,
  previous: Mirror | null
): Mirror | null {
  if (!raw.id) return null;
  const ordoId =
    raw.extendedProperties?.private?.ordoId ??
    previous?.ordoId ??
    itemIdFromEventId(raw.id);
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
  const at = new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    date ?? 1,
    hours ?? 0,
    (minutes ?? 0) + plusMinutes
  );
  return `${dateKey(at)}T${clock(at)}:00`;
}

// The body of an insert or patch. Nulls clear the other time variant when an
// event switches between all-day and timed under patch semantics.
export function eventPayload(
  db: Db,
  item: Item,
  options: {
    timeZone: string;
    minutes: number | null;
    create: boolean;
    origin: string | null;
    eventId?: string;
  }
): Record<string, unknown> | null {
  const content = contentOfItem(item);
  if (!content) return null;
  const extras = extrasOfItem(db, item);
  const reminderDay = options.eventId ? dayFromEventId(options.eventId) : null;
  const slot: Slot =
    reminderDay && !item.dueAt
      ? { kind: "day", start: reminderDay, last: reminderDay }
      : content.slot;
  const lastReminder =
    reminderDay !== null &&
    item.plannedFor !== null &&
    reminderDay === planEnd(item.plannedFor, item.planUntil);
  const timing =
    slot.kind === "day"
      ? {
          start: { date: slot.start, dateTime: null, timeZone: null },
          end: { date: addDays(slot.last, 1), dateTime: null, timeZone: null },
        }
      : {
          start: {
            dateTime: localStamp(slot.day, slot.time),
            timeZone: options.timeZone,
            date: null,
          },
          end: {
            dateTime: localStamp(
              slot.day,
              slot.time,
              options.minutes ?? DEFAULT_MINUTES
            ),
            timeZone: options.timeZone,
            date: null,
          },
        };
  const payload: Record<string, unknown> = {
    summary: `${extras.done ? DONE_MARK : ""}${lastReminder ? LAST_MARK : ""}${
      content.title
    }`,
    description: extras.body,
    colorId: extras.colorId,
    status: "confirmed",
    ...timing,
    extendedProperties: { private: { ordoId: item.id } },
  };
  if (options.create) {
    payload.id = options.eventId ?? eventIdFor(item.id);
    payload.transparency = "transparent";
    if (options.origin?.startsWith("http"))
      payload.source = { title: CALENDAR_NAME, url: options.origin };
    if (payload.colorId === null) delete payload.colorId;
    const start = payload.start as Record<string, unknown>;
    const end = payload.end as Record<string, unknown>;
    for (const edge of [start, end])
      for (const key of Object.keys(edge))
        if (edge[key] === null) delete edge[key];
  }
  return payload;
}

// How a Google-side change becomes an Ordo patch. Ordo keeps due and plan
// exclusive, and a single day keeps whichever role the task already had.
export function pullPatch(item: Item, google: Content): ItemPatch {
  const patch: ItemPatch = {};
  if (google.title && google.title !== item.title.trim())
    patch.title = google.title;
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

function wantedReminderDays(
  item: Item,
  today: string,
  done: boolean,
  liveIds: Set<string>
): string[] {
  if (!item.plannedFor) return [];
  const end = planEnd(item.plannedFor, item.planUntil);
  const oldest = addDays(today, -CREATE_BACK_DAYS);
  return reminderDays(item.plannedFor, item.planUntil, item.priority).filter(
    (day) => {
      if (day > today) return !done;
      if (done) return liveIds.has(eventIdFor(item.id, day)) || day === today;
      if (day >= today) return true;
      return day === end && day >= oldest;
    }
  );
}

function reminderSlot(day: string): Slot {
  return { kind: "day", start: day, last: day };
}

function syncReminders(
  actions: Action[],
  db: Db,
  item: Item,
  list: Mirror[],
  base: Base | null,
  tombstones: Record<string, number>,
  today: string
) {
  const ordo = contentOfItem(item);
  if (!ordo || !item.plannedFor) return;
  const extras = extrasOfItem(db, item);
  const end = planEnd(item.plannedFor, item.planUntil);
  const live = list.filter((mirror) => !mirror.cancelled);
  const liveIds = new Set(live.map((mirror) => mirror.eventId));
  const days = wantedReminderDays(item, today, extras.done, liveIds);
  const wanted = new Set(days.map((day) => eventIdFor(item.id, day)));
  if (live.length === 0 && list.length > 0) {
    const googleDeleted = list.some(
      (mirror) => tombstones[mirror.eventId] === undefined
    );
    const untouched =
      !base || (sameContent(base.content, ordo) && sameExtras(base, extras));
    const newest = list.reduce((left, right) =>
      newer(left.updated, right.updated) ? left : right
    );
    if (googleDeleted && untouched && newer(newest.updated, item.updatedAt)) {
      actions.push({ kind: "trash", itemId: item.id });
      return;
    }
  }
  for (const day of days) {
    const mirror = live.find(
      (entry) => entry.eventId === eventIdFor(item.id, day)
    );
    if (!mirror) continue;
    const google = contentOfMirror(mirror);
    const slotOk = google !== null && sameSlot(google.slot, reminderSlot(day));
    const titleOk = plainTitle(mirror.summary) === item.title.trim();
    if (slotOk && titleOk) continue;
    const googleWins =
      google !== null &&
      !(base && sameContent(base.content, google)) &&
      ((base && sameContent(base.content, ordo)) ||
        newer(mirror.updated, item.updatedAt));
    if (!google || !googleWins) continue;
    const moved = !slotOk;
    actions.push({
      kind: "pull",
      itemId: item.id,
      patch: moved
        ? pullPatch(item, google)
        : google.title
        ? { title: google.title }
        : {},
      base: {
        content: moved ? google : { title: google.title, slot: ordo.slot },
        ...(base
          ? { done: base.done, colorId: base.colorId, body: base.body }
          : extrasOfMirror(mirror)),
      },
    });
    return;
  }
  let drift = false;
  for (const day of days) {
    const eventId = eventIdFor(item.id, day);
    const mirror = live.find((entry) => entry.eventId === eventId);
    if (!mirror) {
      const recent = day >= addDays(today, -CREATE_BACK_DAYS);
      if (base || recent || !extras.done)
        actions.push({ kind: "create", itemId: item.id, eventId });
      drift = true;
      continue;
    }
    const google = contentOfMirror(mirror);
    const slotOk = google !== null && sameSlot(google.slot, reminderSlot(day));
    const titleOk = plainTitle(mirror.summary) === item.title.trim();
    const markOk =
      (day === end) === stripDone(mirror.summary).trim().startsWith(LAST_MARK);
    const extrasMoved = base
      ? !sameExtras(base, extras)
      : !sameExtras(extrasOfMirror(mirror), extras);
    if (!slotOk || !titleOk) {
      actions.push({ kind: "update", itemId: item.id, eventId });
      drift = true;
      continue;
    }
    if (!markOk || extrasMoved) {
      actions.push({ kind: "update", itemId: item.id, eventId });
      drift = true;
    }
  }
  for (const mirror of live) {
    if (wanted.has(mirror.eventId)) continue;
    actions.push({ kind: "delete", eventId: mirror.eventId, itemId: item.id });
    drift = true;
  }
  if (
    !drift &&
    (!base || !sameContent(base.content, ordo) || !sameExtras(base, extras))
  )
    actions.push({ kind: "agree", itemId: item.id });
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
  const grouped = new Map<string, Mirror[]>();
  for (const mirror of Object.values(mirrors)) {
    if (!mirror.ordoId) continue;
    const list = grouped.get(mirror.ordoId) ?? [];
    list.push(mirror);
    grouped.set(mirror.ordoId, list);
  }
  const fresh = db.items.length === 0;
  for (const item of db.items) {
    const list = grouped.get(item.id) ?? [];
    grouped.delete(item.id);
    const base = bases[item.id] ?? null;
    if (!belongsInCalendar(db, item)) {
      const live = list.filter((mirror) => !mirror.cancelled);
      if (live.length > 0) {
        for (const mirror of live)
          actions.push({
            kind: "delete",
            eventId: mirror.eventId,
            itemId: item.id,
          });
      } else if (base) actions.push({ kind: "forget", itemId: item.id });
      continue;
    }
    if (usesReminders(item)) {
      syncReminders(actions, db, item, list, base, tombstones, today);
      continue;
    }
    const mirror =
      list.find((entry) => entry.eventId === eventIdFor(item.id)) ??
      list[0] ??
      null;
    for (const extra of list) {
      if (extra === mirror || extra.cancelled) continue;
      actions.push({ kind: "delete", eventId: extra.eventId, itemId: item.id });
    }
    const ordo = contentOfItem(item);
    if (!ordo) continue;
    const extras = extrasOfItem(db, item);
    if (!mirror) {
      const slot = ordo.slot;
      const lastDay = slot.kind === "day" ? slot.last : slot.day;
      const recent = lastDay >= addDays(today, -CREATE_BACK_DAYS);
      if (base || recent || !extras.done)
        actions.push({ kind: "create", itemId: item.id });
      continue;
    }
    if (mirror.cancelled) {
      const ours = tombstones[mirror.eventId] !== undefined;
      const untouched = !base || sameContent(base.content, ordo);
      if (!ours && untouched && newer(mirror.updated, item.updatedAt))
        actions.push({ kind: "trash", itemId: item.id });
      else
        actions.push({
          kind: "update",
          itemId: item.id,
          eventId: mirror.eventId,
        });
      continue;
    }
    const google = contentOfMirror(mirror);
    const extrasMoved = base
      ? !sameExtras(base, extras)
      : !sameExtras(extrasOfMirror(mirror), extras);
    if (sameContent(ordo, google)) {
      if (extrasMoved)
        actions.push({
          kind: "update",
          itemId: item.id,
          eventId: mirror.eventId,
        });
      else if (
        !base ||
        !sameContent(base.content, ordo) ||
        !sameExtras(base, extras)
      )
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
    const push: Action = {
      kind: "update",
      itemId: item.id,
      eventId: mirror.eventId,
    };
    let chosen: Action | null;
    if (base && sameContent(base.content, google)) chosen = push;
    else if (base && sameContent(base.content, ordo)) chosen = pull();
    else chosen = newer(mirror.updated, item.updatedAt) ? pull() : push;
    actions.push(chosen ?? push);
  }
  if (fresh) return actions;
  for (const [ordoId, list] of grouped) {
    if (!bases[ordoId]) continue;
    for (const mirror of list) {
      if (mirror.cancelled) continue;
      actions.push({ kind: "delete", eventId: mirror.eventId, itemId: ordoId });
    }
  }
  return actions;
}
