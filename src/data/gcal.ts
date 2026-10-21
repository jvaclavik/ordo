// Read-only view of the user's Google Calendar. Events never enter the Ordo
// database: they are not synced through Evolu, not in undo history and not in
// the JSON backup. Each device keeps its own cache in localStorage, so the
// calendar still shows the last known events offline.
import { useEffect, useSyncExternalStore } from "react";
import { todayKey } from "../domain/dates.ts";
import {
  calendarFromApi,
  eventFromApi,
  monthWindow,
  type ApiCalendar,
  type ApiEvent,
  type CalEvent,
  type GcalCalendar,
} from "../lib/gcalEvents.ts";
import {
  GcalError,
  GoogleError,
  type GcalPhase,
  type GoogleApi,
} from "../lib/googleErrors.ts";

export { GcalError, GoogleError, type GcalPhase };

const STORE_KEY = "ordo-gcal";
const API = "https://www.googleapis.com/calendar/v3";
const FRESH_MS = 5 * 60_000;
const CALENDARS_FRESH_MS = 60 * 60_000;
const KEEP_MONTHS = 6;
const EVENT_FIELDS =
  "nextPageToken,items(id,status,summary,location,htmlLink,colorId,eventType,start,end,attendees(self,responseStatus))";
const CALENDAR_FIELDS =
  "nextPageToken,items(id,summary,summaryOverride,description,backgroundColor,primary,selected,hidden,deleted)";

type Bucket = { fetchedAt: number; calendarIds: string[]; events: CalEvent[] };

type Stored = {
  connected: boolean;
  account: string | null;
  calendars: GcalCalendar[];
  calendarsAt: number;
  shown: Record<string, boolean>;
  months: Record<string, Bucket>;
  syncedAt: number | null;
};

export type GcalView = Stored & { phase: GcalPhase; busy: boolean };

function empty(): Stored {
  return {
    connected: false,
    account: null,
    calendars: [],
    calendarsAt: 0,
    shown: {},
    months: {},
    syncedAt: null,
  };
}

function restore(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed !== "object" || parsed === null) return empty();
    return {
      connected: parsed.connected === true,
      account: typeof parsed.account === "string" ? parsed.account : null,
      calendars: Array.isArray(parsed.calendars) ? parsed.calendars : [],
      calendarsAt: 0,
      shown:
        parsed.shown && typeof parsed.shown === "object" ? parsed.shown : {},
      months:
        parsed.months && typeof parsed.months === "object" ? parsed.months : {},
      syncedAt: typeof parsed.syncedAt === "number" ? parsed.syncedAt : null,
    };
  } catch {
    return empty();
  }
}

const listeners = new Set<() => void>();
const initial = typeof window === "undefined" ? empty() : restore();
let view: GcalView = {
  ...initial,
  phase: initial.connected ? "loading" : "off",
  busy: false,
};
let saveTimer = 0;

function emit() {
  for (const listener of listeners) listener();
}

function setView(patch: Partial<GcalView>, persist = false) {
  view = { ...view, ...patch };
  emit();
  if (persist) queueSave();
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      if (!view.connected) {
        localStorage.removeItem(STORE_KEY);
        return;
      }
      const stored: Stored = {
        connected: view.connected,
        account: view.account,
        calendars: view.calendars,
        calendarsAt: view.calendarsAt,
        shown: view.shown,
        months: view.months,
        syncedAt: view.syncedAt,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    } catch {
      return;
    }
  }, 200);
}

export function getGcalView() {
  return view;
}

export function subscribeGcal(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGcal() {
  return useSyncExternalStore(subscribeGcal, getGcalView, getGcalView);
}

export function isCalendarShown(
  state: Pick<GcalView, "shown">,
  calendar: GcalCalendar
): boolean {
  return state.shown[calendar.id] ?? calendar.selected;
}

// The calendar Ordo writes tasks into is never read back as foreign events,
// or every task would show twice.
export function readableCalendars(state: Pick<GcalView, "calendars">): GcalCalendar[] {
  return state.calendars.filter((calendar) => !calendar.managed);
}

function shownCalendars(): GcalCalendar[] {
  return readableCalendars(view).filter((calendar) => isCalendarShown(view, calendar));
}

let token: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;
let epoch = 0;

async function requestToken(): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/gcal/token", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    throw new GcalError("offline");
  }
  if (response.status === 401) throw new GcalError("reconnect");
  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 501
  )
    throw new GcalError("unconfigured");
  if (!response.ok) throw new GcalError("error");
  let data: { accessToken?: unknown; expiresIn?: unknown };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new GcalError("unconfigured");
  }
  if (typeof data.accessToken !== "string") throw new GcalError("error");
  const lifetime = typeof data.expiresIn === "number" ? data.expiresIn : 3600;
  token = { value: data.accessToken, expiresAt: Date.now() + lifetime * 1000 };
  return token.value;
}

function accessToken(force: boolean): Promise<string> {
  if (!force && token && token.expiresAt > Date.now() + 60_000)
    return Promise.resolve(token.value);
  if (force) token = null;
  tokenRequest ??= requestToken().finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

export const googleApi: GoogleApi = async <T,>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { params?: Record<string, string>; body?: unknown } = {}
): Promise<T> => {
  const query = options.params
    ? `?${new URLSearchParams(options.params).toString()}`
    : "";
  for (let attempt = 0; ; attempt += 1) {
    const value = await accessToken(attempt > 0);
    let response: Response;
    try {
      response = await fetch(`${API}${path}${query}`, {
        method,
        headers: {
          authorization: `Bearer ${value}`,
          ...(options.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
    } catch {
      throw new GcalError("offline");
    }
    if (response.status === 401 && attempt === 0) continue;
    if (response.status === 401) throw new GcalError("reconnect");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GoogleError(response.status, /insufficient/i.test(text));
    }
    if (response.status === 204) return null as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
};

function google<T>(path: string, params: Record<string, string>): Promise<T> {
  return googleApi<T>("GET", path, { params });
}

async function loadCalendars(force: boolean): Promise<GcalCalendar[]> {
  if (
    !force &&
    view.calendars.length > 0 &&
    Date.now() - view.calendarsAt < CALENDARS_FRESH_MS
  )
    return view.calendars;
  const ticket = epoch;
  const raw: ApiCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ items?: ApiCalendar[]; nextPageToken?: string }>(
      "/users/me/calendarList",
      {
        minAccessRole: "reader",
        maxResults: "250",
        fields: CALENDAR_FIELDS,
        ...(pageToken ? { pageToken } : {}),
      }
    );
    raw.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  const calendars = raw
    .flatMap((entry) => {
      const calendar = calendarFromApi(entry);
      return calendar ? [calendar] : [];
    })
    .sort(
      (left, right) =>
        Number(right.primary) - Number(left.primary) ||
        left.name.localeCompare(right.name, "cs")
    );
  if (ticket !== epoch) return calendars;
  setView(
    {
      calendars,
      calendarsAt: Date.now(),
      account: calendars.find((calendar) => calendar.primary)?.id ?? view.account,
    },
    true
  );
  return calendars;
}

async function calendarEvents(
  calendar: GcalCalendar,
  month: string
): Promise<CalEvent[]> {
  const { timeMin, timeMax } = monthWindow(month);
  const events: CalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ items?: ApiEvent[]; nextPageToken?: string }>(
      `/calendars/${encodeURIComponent(calendar.id)}/events`,
      {
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
        maxAttendees: "1",
        fields: EVENT_FIELDS,
        ...(pageToken ? { pageToken } : {}),
      }
    );
    for (const raw of page.items ?? []) {
      const event = eventFromApi(raw, calendar);
      if (event) events.push(event);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

export function phaseOf(error: unknown): GcalPhase {
  if (error instanceof GcalError) return error.phase;
  if (error instanceof GoogleError && error.scope) return "reconnect";
  return "error";
}

// Lets the task sync report an expired or missing grant it ran into.
export function reportGcalProblem(phase: GcalPhase) {
  if (!view.connected) return;
  if (phase === "reconnect" || phase === "unconfigured") setView({ phase });
}

const sessionListeners = new Set<() => void>();

// Fires when this device connects a Google account anew or disconnects.
export function onGcalSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function sessionChanged() {
  for (const listener of sessionListeners) listener();
}

let running = 0;

async function guard(task: () => Promise<void>) {
  const ticket = epoch;
  running += 1;
  setView({ busy: true });
  try {
    await task();
    if (ticket === epoch && view.connected)
      setView({ phase: "ready", syncedAt: Date.now() }, true);
  } catch (error) {
    if (ticket === epoch && view.connected) setView({ phase: phaseOf(error) });
  } finally {
    running -= 1;
    setView({ busy: running > 0 });
  }
}

function isStale(month: string): boolean {
  const bucket = view.months[month];
  if (!bucket) return true;
  if (Date.now() - bucket.fetchedAt > FRESH_MS) return true;
  return shownCalendars().some(
    (calendar) => !bucket.calendarIds.includes(calendar.id)
  );
}

function putMonth(month: string, bucket: Bucket) {
  const months = { ...view.months, [month]: bucket };
  const keep = Object.entries(months)
    .sort((left, right) => right[1].fetchedAt - left[1].fetchedAt)
    .slice(0, KEEP_MONTHS);
  setView({ months: Object.fromEntries(keep) }, true);
}

const pending = new Map<string, Promise<void>>();

function loadMonth(month: string, force = false): Promise<void> {
  if (!view.connected) return Promise.resolve();
  if (!force && (view.phase === "reconnect" || view.phase === "unconfigured"))
    return Promise.resolve();
  if (!force && !isStale(month)) return Promise.resolve();
  const existing = pending.get(month);
  if (existing) return existing;
  const ticket = epoch;
  const task = guard(async () => {
    const calendars = readableCalendars({
      calendars: await loadCalendars(force),
    }).filter((calendar) => isCalendarShown(view, calendar));
    const lists = await Promise.all(
      calendars.map((calendar) =>
        calendarEvents(calendar, month).catch((error: unknown) => {
          if (
            error instanceof GoogleError &&
            !error.scope &&
            (error.status === 403 || error.status === 404)
          )
            return [];
          throw error;
        })
      )
    );
    if (ticket !== epoch) return;
    putMonth(month, {
      fetchedAt: Date.now(),
      calendarIds: calendars.map((calendar) => calendar.id),
      events: lists.flat(),
    });
  }).finally(() => pending.delete(month));
  pending.set(month, task);
  return task;
}

const watched = new Map<string, number>();

function refreshWatched(force: boolean) {
  const months = new Set([todayKey().slice(0, 7), ...watched.keys()]);
  for (const month of months) void loadMonth(month, force);
}

export function refreshGcal() {
  if (!view.connected) return;
  setView({ calendarsAt: 0 });
  refreshWatched(true);
}

export function connectGcal() {
  window.location.assign("/api/gcal/login");
}

export async function disconnectGcal() {
  epoch += 1;
  token = null;
  pending.clear();
  view = { ...empty(), phase: "off", busy: false };
  emit();
  queueSave();
  sessionChanged();
  try {
    await fetch("/api/gcal/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    return;
  }
}

export function setCalendarShown(id: string, shown: boolean) {
  setView({ shown: { ...view.shown, [id]: shown } }, true);
  if (shown) refreshWatched(false);
}

// Called once with the ?gcal= value that /api/gcal/callback redirects back with.
export function acceptGcalReturn(result: string): string {
  if (result === "connected") {
    epoch += 1;
    token = null;
    pending.clear();
    view = { ...empty(), connected: true, phase: "loading", busy: false };
    emit();
    queueSave();
    sessionChanged();
    refreshWatched(true);
    return "Google Kalendář je připojený.";
  }
  if (result === "unconfigured") {
    if (!view.connected) setView({ phase: "unconfigured" });
    return "Server nemá nastavené přihlášení přes Google.";
  }
  if (result === "denied") return "Připojení ke Google Kalendáři bylo zrušené.";
  if (result === "scope")
    return "Google nepovolil čtení kalendáře. Při připojení nech přístup ke kalendáři zaškrtnutý.";
  return "Připojení ke Google Kalendáři se nepovedlo.";
}

let started = false;

export function startGcal() {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => {
    if (document.visibilityState !== "visible") return;
    refreshWatched(false);
  };
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("online", tick);
  window.setInterval(tick, FRESH_MS);
  tick();
}

export function useGcalMonth(month: string | null): CalEvent[] {
  const state = useGcal();
  useEffect(() => {
    if (!month) return;
    watched.set(month, (watched.get(month) ?? 0) + 1);
    void loadMonth(month);
    return () => {
      const left = (watched.get(month) ?? 1) - 1;
      if (left <= 0) watched.delete(month);
      else watched.set(month, left);
    };
  }, [month, state.connected]);
  if (!month || !state.connected) return [];
  const bucket = state.months[month];
  if (!bucket) return [];
  const hidden = new Set(
    state.calendars
      .filter((calendar) => calendar.managed || !isCalendarShown(state, calendar))
      .map((calendar) => calendar.id)
  );
  return bucket.events.filter((event) => !hidden.has(event.calendarId));
}
