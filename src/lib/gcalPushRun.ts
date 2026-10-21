// One sync pass between Ordo and its Google calendar. Everything with side
// effects comes in through `deps`, so tests can run it against a fake Google.
import { byId } from "../domain/db.ts";
import type { Op } from "../domain/op.ts";
import type { Db, Item } from "../domain/types.ts";
import {
  baseOf,
  belongsInCalendar,
  CALENDAR_DESCRIPTION,
  CALENDAR_NAME,
  eventIdFor,
  eventPayload,
  mirrorFromApi,
  planSync,
  SYNC_MARK,
  type Action,
  type ApiSyncEvent,
  type Base,
  type Mirror,
} from "./gcalPush.ts";
import { GcalError, GoogleError, type GoogleApi } from "./googleErrors.ts";

export const MAX_WRITES = 40;
const PARALLEL = 3;
const SYNC_FIELDS =
  "nextPageToken,nextSyncToken,items(id,status,updated,summary,description,colorId,start,end,extendedProperties)";

export type PushState = {
  enabled: boolean;
  calendarId: string | null;
  syncToken: string | null;
  mirrors: Record<string, Mirror>;
  bases: Record<string, Base>;
  tombstones: Record<string, number>;
  syncedAt: number | null;
};

export type PushDeps = {
  api: GoogleApi;
  getDb: () => Db;
  dispatch: (op: Op) => unknown;
  timeZone: string;
  origin: string | null;
  today: string;
  allowTrash: boolean;
  now: () => number;
};

export type PushResult = {
  calendarId: string;
  pending: number;
  failed: number;
  trashed: string[];
};

export function emptyPushState(enabled: boolean): PushState {
  return {
    enabled,
    calendarId: null,
    syncToken: null,
    mirrors: {},
    bases: {},
    tombstones: {},
    syncedAt: null,
  };
}

export function countSyncedEvents(state: PushState): number {
  return Object.values(state.mirrors).filter((mirror) => !mirror.cancelled && mirror.ordoId)
    .length;
}

function calendarPath(calendarId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}`;
}

function eventPath(calendarId: string, eventId: string): string {
  return `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

function gone(error: unknown): boolean {
  return error instanceof GoogleError && (error.status === 404 || error.status === 410);
}

type CalendarList = {
  items?: Array<{ id?: string; description?: string; deleted?: boolean }>;
};

async function ensureCalendar(state: PushState, deps: PushDeps): Promise<string> {
  if (state.calendarId) return state.calendarId;
  const list = await deps.api<CalendarList>("GET", "/users/me/calendarList", {
    params: {
      minAccessRole: "owner",
      showHidden: "true",
      maxResults: "250",
      fields: "items(id,description,deleted)",
    },
  });
  const found = list?.items?.find(
    (entry) => entry.id && !entry.deleted && entry.description?.includes(SYNC_MARK)
  );
  const id =
    found?.id ??
    (
      await deps.api<{ id?: string }>("POST", "/calendars", {
        body: {
          summary: CALENDAR_NAME,
          description: CALENDAR_DESCRIPTION,
          timeZone: deps.timeZone,
        },
      })
    )?.id;
  if (!id) throw new GoogleError(500, false);
  state.calendarId = id;
  state.syncToken = null;
  state.mirrors = {};
  state.tombstones = {};
  return id;
}

type EventPage = { items?: ApiSyncEvent[]; nextPageToken?: string; nextSyncToken?: string };

async function pullChanges(state: PushState, deps: PushDeps, calendarId: string) {
  const collected: ApiSyncEvent[] = [];
  const full = !state.syncToken;
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  try {
    do {
      const page = await deps.api<EventPage>("GET", `${calendarPath(calendarId)}/events`, {
        params: {
          maxResults: "2500",
          showDeleted: "true",
          fields: SYNC_FIELDS,
          ...(state.syncToken ? { syncToken: state.syncToken } : {}),
          ...(pageToken ? { pageToken } : {}),
        },
      });
      collected.push(...(page?.items ?? []));
      pageToken = page?.nextPageToken;
      nextSyncToken = page?.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleError && error.status === 410 && !full) {
      state.syncToken = null;
      await pullChanges(state, deps, calendarId);
      return;
    }
    throw error;
  }
  const previous = state.mirrors;
  const mirrors: Record<string, Mirror> = full ? {} : { ...previous };
  for (const raw of collected) {
    const mirror = mirrorFromApi(raw, (raw.id && previous[raw.id]) || null);
    if (mirror) mirrors[mirror.eventId] = mirror;
  }
  state.mirrors = mirrors;
  state.syncToken = nextSyncToken;
}

function record(state: PushState, raw: ApiSyncEvent | null, item: Item, db: Db) {
  if (!raw?.id) return;
  const mirror = mirrorFromApi(raw, state.mirrors[raw.id] ?? null);
  if (!mirror) return;
  state.mirrors[mirror.eventId] = mirror;
  const base = baseOf(db, item);
  if (base) state.bases[item.id] = base;
  delete state.tombstones[mirror.eventId];
}

function payload(state: PushState, deps: PushDeps, db: Db, item: Item, create: boolean) {
  return eventPayload(db, item, {
    timeZone: deps.timeZone,
    minutes: state.mirrors[eventIdFor(item.id)]?.minutes ?? null,
    create,
    origin: create ? deps.origin : null,
  });
}

async function createEvent(state: PushState, deps: PushDeps, calendarId: string, item: Item, db: Db) {
  const body = payload(state, deps, db, item, true);
  if (!body) return;
  try {
    record(state, await deps.api<ApiSyncEvent>("POST", `${calendarPath(calendarId)}/events`, { body }), item, db);
  } catch (error) {
    if (!(error instanceof GoogleError) || error.status !== 409) throw error;
    await patchEvent(state, deps, calendarId, eventIdFor(item.id), item, db);
  }
}

async function patchEvent(
  state: PushState,
  deps: PushDeps,
  calendarId: string,
  eventId: string,
  item: Item,
  db: Db
) {
  const body = payload(state, deps, db, item, false);
  if (!body) return;
  try {
    record(state, await deps.api<ApiSyncEvent>("PATCH", eventPath(calendarId, eventId), { body }), item, db);
  } catch (error) {
    if (!gone(error) || eventId !== eventIdFor(item.id)) throw error;
    delete state.mirrors[eventId];
    record(
      state,
      await deps.api<ApiSyncEvent>("POST", `${calendarPath(calendarId)}/events`, {
        body: payload(state, deps, db, item, true),
      }),
      item,
      db
    );
  }
}

async function deleteEvent(
  state: PushState,
  deps: PushDeps,
  calendarId: string,
  eventId: string,
  itemId: string | null
) {
  try {
    await deps.api<null>("DELETE", eventPath(calendarId, eventId));
  } catch (error) {
    if (!gone(error)) throw error;
  }
  const mirror = state.mirrors[eventId];
  if (mirror)
    state.mirrors[eventId] = {
      ...mirror,
      cancelled: true,
      updated: new Date(deps.now()).toISOString(),
    };
  state.tombstones[eventId] = deps.now();
  if (itemId) delete state.bases[itemId];
}

async function write(state: PushState, deps: PushDeps, calendarId: string, action: Action) {
  if (action.kind === "delete") {
    await deleteEvent(state, deps, calendarId, action.eventId, action.itemId);
    return;
  }
  if (action.kind !== "create" && action.kind !== "update") return;
  const db = deps.getDb();
  const item = byId(db.items, action.itemId);
  if (!item || !belongsInCalendar(db, item)) return;
  if (action.kind === "create") await createEvent(state, deps, calendarId, item, db);
  else await patchEvent(state, deps, calendarId, action.eventId, item, db);
}

function applyLocal(state: PushState, deps: PushDeps, actions: Action[], db: Db): string[] {
  const ops: Op[] = [];
  const trashed: string[] = [];
  for (const action of actions) {
    if (action.kind === "agree") {
      const item = byId(db.items, action.itemId);
      const base = item ? baseOf(db, item) : null;
      if (base) state.bases[action.itemId] = base;
    } else if (action.kind === "forget") {
      delete state.bases[action.itemId];
    } else if (action.kind === "pull") {
      if (Object.keys(action.patch).length > 0)
        ops.push({ type: "updateItem", id: action.itemId, patch: action.patch });
      state.bases[action.itemId] = action.base;
    } else if (action.kind === "trash" && deps.allowTrash) {
      ops.push({ type: "deleteItem", id: action.itemId });
      delete state.bases[action.itemId];
      trashed.push(byId(db.items, action.itemId)?.title ?? "");
    }
  }
  if (ops.length > 0) deps.dispatch({ type: "batch", ops });
  return trashed;
}

// Stops the whole pass on connection, permission or rate problems. Other
// failures only skip that one task, and the next pass tries it again.
function fatal(error: unknown): boolean {
  if (error instanceof GcalError) return true;
  if (!(error instanceof GoogleError)) return false;
  return error.scope || error.status === 401 || error.status === 403 || error.status === 429;
}

async function inPool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let failed = 0;
  let stop: unknown = null;
  let next = 0;
  const worker = async () => {
    while (next < items.length && stop === null) {
      const item = items[next];
      next += 1;
      if (item === undefined) continue;
      try {
        await task(item);
      } catch (error) {
        if (fatal(error)) stop = error;
        else failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (stop !== null) throw stop;
  return failed;
}

function isWrite(action: Action): boolean {
  return action.kind === "create" || action.kind === "update" || action.kind === "delete";
}

export async function syncOnce(state: PushState, deps: PushDeps): Promise<PushResult> {
  let calendarId = await ensureCalendar(state, deps);
  try {
    await pullChanges(state, deps, calendarId);
  } catch (error) {
    if (!(error instanceof GoogleError) || error.status !== 404) throw error;
    // The Ordo calendar was deleted in Google. Start a fresh one and push
    // every task into it again, rather than reading it as mass deletion.
    state.calendarId = null;
    calendarId = await ensureCalendar(state, deps);
    await pullChanges(state, deps, calendarId);
  }
  const db = deps.getDb();
  const actions = planSync({
    db,
    mirrors: state.mirrors,
    bases: state.bases,
    tombstones: state.tombstones,
    today: deps.today,
  });
  const trashed = applyLocal(
    state,
    deps,
    actions.filter((action) => !isWrite(action)),
    db
  );
  const writes = actions.filter(isWrite);
  const batch = writes.slice(0, MAX_WRITES);
  const failed = await inPool(batch, PARALLEL, (action) => write(state, deps, calendarId, action));
  state.syncedAt = deps.now();
  return { calendarId, pending: writes.length - batch.length, failed, trashed };
}
