import { openDB, type IDBPDatabase } from "idb";
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { isValidDb, withPlan } from "../domain/db.ts";
import { todayKey } from "../domain/dates.ts";
import type { Op } from "../domain/op.ts";
import { freshDb, reduce } from "../domain/reduce.ts";
import type { Ctx, Db } from "../domain/types.ts";

export type Snap = {
  ready: boolean;
  db: Db;
  past: Db[];
  future: Db[];
  memoryOnly: boolean;
  persistError: string | null;
};

const listeners = new Set<() => void>();

let snap: Snap = {
  ready: false,
  db: freshDb(runtime()),
  past: [],
  future: [],
  memoryOnly: false,
  persistError: null,
};

function runtime(): Ctx {
  return { now: new Date().toISOString(), today: todayKey(), id: () => nanoid(10) };
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

export function useSnap() {
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

export function dispatch(op: Op): Db {
  const db = reduce(snap.db, op, runtime());
  if (db === snap.db) return db;
  snap = { ...snap, db, past: [...snap.past, snap.db].slice(-40), future: [] };
  emit();
  queuePersist();
  return db;
}

export function undo() {
  const previous = snap.past.at(-1);
  if (!previous) return;
  snap = { ...snap, db: previous, past: snap.past.slice(0, -1), future: [...snap.future, snap.db] };
  emit();
  queuePersist();
}

export function redo() {
  const next = snap.future.at(-1);
  if (!next) return;
  snap = { ...snap, db: next, future: snap.future.slice(0, -1), past: [...snap.past, snap.db] };
  emit();
  queuePersist();
}

export function canUndo() {
  return snap.past.length > 0;
}

let timer = 0;
let database: IDBPDatabase | null = null;

function queuePersist() {
  if (!snap.ready || snap.memoryOnly || !database) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void persist();
  }, 40);
}

async function persist() {
  if (!database) return;
  try {
    await database.put("kv", snap.db, "state");
    if (snap.persistError) {
      snap = { ...snap, persistError: null };
      emit();
    }
  } catch (error) {
    snap = { ...snap, persistError: error instanceof Error ? error.message : "Uložení selhalo." };
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
      snap = {
        ...snap,
        ready: true,
        db: isValidDb(stored) ? withPlan(stored) : freshDb(runtime()),
        memoryOnly: false,
      };
    } catch {
      snap = { ...snap, ready: true, memoryOnly: true, db: freshDb(runtime()) };
    }
    emit();
  })();
  return loading;
}
