// Keeps the "Ordo" Google calendar in step with Ordo tasks, both ways.
// The rules live in src/lib/gcalPush.ts and one pass in src/lib/gcalPushRun.ts.
// This module decides when to run, stores the per-device sync state in
// localStorage and reports progress to the settings page.
import { useSyncExternalStore } from "react";
import { todayKey } from "../domain/dates.ts";
import {
  countSyncedEvents,
  emptyPushState,
  syncOnce,
  type PushState,
} from "../lib/gcalPushRun.ts";
import {
  getGcalView,
  googleApi,
  onGcalSession,
  phaseOf,
  reportGcalProblem,
  subscribeGcal,
} from "./gcal.ts";
import { dispatch, getDb, isStoreReady, subscribeStore } from "./store.tsx";
import { getSyncView } from "./sync.ts";

const STORE_KEY = "ordo-gcal-push";
const DEBOUNCE_MS = 2500;
const POLL_MS = 2 * 60_000;
const SETTLE_MS = 10_000;

export type PushPhase = "off" | "waiting" | "syncing" | "ready" | "offline" | "error";

export type PushView = {
  enabled: boolean;
  phase: PushPhase;
  syncedAt: number | null;
  count: number;
  pending: number;
  failed: number;
};

function load(): PushState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyPushState(true);
    const parsed = JSON.parse(raw) as Partial<PushState>;
    const record = <T,>(value: unknown): Record<string, T> =>
      value && typeof value === "object" ? (value as Record<string, T>) : {};
    return {
      enabled: parsed.enabled !== false,
      calendarId: typeof parsed.calendarId === "string" ? parsed.calendarId : null,
      syncToken: typeof parsed.syncToken === "string" ? parsed.syncToken : null,
      mirrors: record(parsed.mirrors),
      bases: record(parsed.bases),
      tombstones: record(parsed.tombstones),
      syncedAt: typeof parsed.syncedAt === "number" ? parsed.syncedAt : null,
    };
  } catch {
    return emptyPushState(true);
  }
}

function save(state: PushState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

const initial = typeof window === "undefined" ? emptyPushState(true) : load();
let enabled = initial.enabled;

const listeners = new Set<() => void>();
let view: PushView = {
  enabled,
  phase: enabled ? "waiting" : "off",
  syncedAt: initial.syncedAt,
  count: countSyncedEvents(initial),
  pending: 0,
  failed: 0,
};

function setView(patch: Partial<PushView>) {
  view = { ...view, ...patch };
  for (const listener of listeners) listener();
}

export function getPushView() {
  return view;
}

export function subscribePush(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePush() {
  return useSyncExternalStore(subscribePush, getPushView, getPushView);
}

const noticeListeners = new Set<(text: string) => void>();

export function onPushNotice(listener: (text: string) => void) {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

function notice(trashed: string[]) {
  if (trashed.length === 0) return;
  const text =
    trashed.length === 1
      ? `„${trashed[0]}“ je smazané v Google Kalendáři, úkol je v koši.`
      : `${trashed.length} úkolů je smazaných v Google Kalendáři, najdeš je v koši.`;
  for (const listener of noticeListeners) listener(text);
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// A device on a stale copy of the database could read "date removed on the
// other device" as "deleted in Google". Trash only once Evolu has been
// connected long enough to bring the other devices' edits in.
let syncedSince: number | null = null;

function trashAllowed(): boolean {
  const sync = getSyncView();
  if (!sync.enabled) return true;
  if (sync.phase !== "synced") {
    syncedSince = null;
    return false;
  }
  syncedSince ??= Date.now();
  return Date.now() - syncedSince >= SETTLE_MS;
}

function canRun(): boolean {
  const gcal = getGcalView();
  return (
    enabled &&
    isStoreReady() &&
    gcal.connected &&
    gcal.phase !== "reconnect" &&
    gcal.phase !== "unconfigured"
  );
}

let running = false;
let again = false;

async function runExclusive(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      if (!canRun()) {
        setView({ phase: enabled ? "waiting" : "off" });
        return;
      }
      setView({ phase: "syncing" });
      // Reload on every pass: another tab may have synced in the meantime.
      const state = { ...load(), enabled };
      try {
        const result = await syncOnce(state, {
          api: googleApi,
          getDb,
          dispatch,
          timeZone: timeZone(),
          origin: typeof location === "undefined" ? null : location.origin,
          today: todayKey(),
          allowTrash: trashAllowed(),
          now: () => Date.now(),
        });
        save(state);
        notice(result.trashed);
        setView({
          phase: "ready",
          syncedAt: state.syncedAt,
          count: countSyncedEvents(state),
          pending: result.pending,
          failed: result.failed,
        });
        if (result.pending > 0) again = true;
      } catch (error) {
        save(state);
        const phase = phaseOf(error);
        if (phase === "reconnect" || phase === "unconfigured") reportGcalProblem(phase);
        setView({ phase: phase === "offline" ? "offline" : "error" });
        return;
      }
    } while (again);
  } finally {
    running = false;
  }
}

async function run(): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return runExclusive();
  await locks.request(STORE_KEY, { ifAvailable: true }, async (lock) => {
    if (lock) await runExclusive();
  });
}

let timer = 0;

export function scheduleGcalPush(delay = DEBOUNCE_MS) {
  if (typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void run(), delay);
}

export function syncGcalNow() {
  scheduleGcalPush(0);
}

export function setGcalPushEnabled(next: boolean) {
  enabled = next;
  save({ ...load(), enabled: next });
  setView({ enabled: next, phase: next ? "waiting" : "off" });
  if (next) syncGcalNow();
}

// A new connection may be a different Google account, so start clean.
function resetForSession() {
  window.clearTimeout(timer);
  save(emptyPushState(enabled));
  setView({
    phase: enabled ? "waiting" : "off",
    syncedAt: null,
    count: 0,
    pending: 0,
    failed: 0,
  });
  scheduleGcalPush(500);
}

let started = false;

export function startGcalPush() {
  if (started || typeof window === "undefined") return;
  started = true;
  onGcalSession(resetForSession);
  let lastDb = getDb();
  subscribeStore(() => {
    const db = getDb();
    if (db === lastDb) return;
    lastDb = db;
    scheduleGcalPush();
  });
  let lastReady = false;
  subscribeGcal(() => {
    const gcal = getGcalView();
    const ready = gcal.connected && gcal.phase !== "reconnect";
    if (ready && !lastReady) scheduleGcalPush(500);
    lastReady = ready;
  });
  const tick = () => {
    if (document.visibilityState === "visible") scheduleGcalPush(500);
  };
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("online", tick);
  window.setInterval(tick, POLL_MS);
  scheduleGcalPush(1500);
}
