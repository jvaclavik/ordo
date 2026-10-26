import { openDB, type IDBPDatabase } from "idb";
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { readActivity, recordActivity, type ActivityEntry } from "../domain/activity.ts";
import { todayKey } from "../domain/dates.ts";
import { isValidDb, withPlan } from "../domain/db.ts";
import { needsLastReminderUrgent } from "../domain/horizon.ts";
import type { Op } from "../domain/op.ts";
import { freshDb, reduce } from "../domain/reduce.ts";
import { isOpenItem } from "../domain/select.ts";
import type { Ctx, Db } from "../domain/types.ts";
import { noteLocal, startSync } from "./sync.ts";
import {
  collapseInboxes,
  fingerprint,
  isUntouched,
  mergeLatest,
} from "./syncMap.ts";

export type Snap = {
  ready: boolean;
  db: Db;
  activity: ActivityEntry[];
  past: Db[];
  future: Db[];
  memoryOnly: boolean;
  persistError: string | null;
};

const listeners = new Set<() => void>();

let snap: Snap = {
  ready: false,
  db: freshDb(runtime()),
  activity: [],
  past: [],
  future: [],
  memoryOnly: false,
  persistError: null,
};

function runtime(): Ctx {
  return {
    now: new Date().toISOString(),
    today: todayKey(),
    id: () => nanoid(10),
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnap() {
  return snap;
}

export function getDb(): Db {
  return snap.db;
}

export function isStoreReady(): boolean {
  return snap.ready;
}

export function subscribeStore(listener: () => void) {
  return subscribe(listener);
}

export function useSnap() {
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

export function dispatch(op: Op): Db {
  const before = snap.db;
  const db = reduce(before, op, runtime());
  if (db === before) return db;
  const activity = [...recordActivity(before, op, runtime()).reverse(), ...snap.activity].slice(0, 100);
  snap = { ...snap, db, activity, past: [...snap.past, before].slice(-40), future: [] };
  emit();
  queuePersist();
  return db;
}

export function undo() {
  const previous = snap.past.at(-1);
  if (!previous) return;
  snap = {
    ...snap,
    db: previous,
    past: snap.past.slice(0, -1),
    future: [...snap.future, snap.db],
  };
  emit();
  queuePersist();
}

export function redo() {
  const next = snap.future.at(-1);
  if (!next) return;
  snap = {
    ...snap,
    db: next,
    future: snap.future.slice(0, -1),
    past: [...snap.past, snap.db],
  };
  emit();
  queuePersist();
}

export function canUndo() {
  return snap.past.length > 0;
}

let timer = 0;
let database: IDBPDatabase | null = null;

function queuePersist() {
  if (!snap.ready) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(flushPersist, 40);
}

function flushPersist() {
  window.clearTimeout(timer);
  if (!snap.ready) return;
  if (!snap.memoryOnly && database) void persist();
  noteLocal(snap.db);
}

function promoteLastReminders() {
  if (!snap.ready) return;
  const today = todayKey();
  const ops: Op[] = [];
  for (const item of snap.db.items) {
    if (!isOpenItem(snap.db, item) || !needsLastReminderUrgent(item, today))
      continue;
    ops.push({
      type: "updateItem",
      id: item.id,
      patch: { priority: "urgent" },
    });
  }
  if (ops.length > 0) dispatch({ type: "batch", ops });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPersist);
  window.addEventListener("focus", promoteLastReminders);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersist();
    else promoteLastReminders();
  });
}

async function persist() {
  if (!database) return;
  try {
    await database.put("kv", snap.db, "state");
    await database.put("kv", snap.activity, "activity");
    if (snap.persistError) {
      snap = { ...snap, persistError: null };
      emit();
    }
  } catch (error) {
    snap = {
      ...snap,
      persistError: error instanceof Error ? error.message : "Uložení selhalo.",
    };
    emit();
  }
}

let loading: Promise<void> | null = null;

export function loadStore() {
  loading ??= (async () => {
    try {
      database = await openDB("ukoly", 1, {
        upgrade(next) {
          next.createObjectStore("kv");
        },
      });
      const stored = await database.get("kv", "state");
      const storedActivity = await database.get("kv", "activity");
      const local = isValidDb(stored)
        ? collapseInboxes(withPlan(stored))
        : null;
      snap = {
        ...snap,
        ready: true,
        db: local ?? freshDb(runtime()),
        activity: readActivity(storedActivity),
        memoryOnly: false,
      };
      emit();
      try {
        await startSync(
          () => snap.db,
          (incoming) => {
            const merged = isUntouched(snap.db)
              ? incoming
              : collapseInboxes(mergeLatest(incoming, snap.db));
            if (fingerprint(merged) !== fingerprint(incoming))
              noteLocal(merged);
            if (fingerprint(merged) === fingerprint(snap.db)) return;
            snap = { ...snap, db: merged, past: [], future: [] };
            emit();
            void persist();
            promoteLastReminders();
          }
        );
      } catch (error) {
        snap = {
          ...snap,
          persistError:
            error instanceof Error
              ? error.message
              : "Synchronizace se nepovedla.",
        };
        emit();
      }
      promoteLastReminders();
      return;
    } catch {
      snap = {
        ...snap,
        ready: true,
        memoryOnly: true,
        db: freshDb(runtime()),
        activity: [],
      };
    }
    emit();
    promoteLastReminders();
  })();
  return loading;
}
