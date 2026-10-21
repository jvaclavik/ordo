import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  acceptGcalReturn,
  connectGcal,
  disconnectGcal,
  isCalendarShown,
  readableCalendars,
  refreshGcal,
  setCalendarShown,
  useGcal,
  type GcalView,
} from "../data/gcal.ts";
import {
  onPushNotice,
  setGcalPushEnabled,
  syncGcalNow,
  usePush,
  type PushView,
} from "../data/gcalPush.ts";
import { formatDay, todayKey } from "../domain/dates.ts";
import { eventTimeLabel, type CalEvent } from "../lib/gcalEvents.ts";
import { useUi } from "./state.tsx";
import { Button, cx, hoverRow } from "./ui.tsx";

function syncedLabel(at: number | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  const time = date.toLocaleTimeString("cs-CZ", {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = formatDay(todayKey(date), todayKey());
  return day === "dnes" ? `v ${time}` : `${day} v ${time}`;
}

function statusText(gcal: GcalView): string {
  if (gcal.phase === "unconfigured")
    return "Na serveru chybí přihlašovací údaje Google. Postup je v README v části Google Kalendář.";
  if (!gcal.connected)
    return "Události z Google Kalendáře uvidíš v kalendáři a v přehledu Dnes. Úkoly s termínem se zapíšou do nového kalendáře Ordo, ostatní kalendáře Ordo jen čte. Připojení platí pro tohle zařízení.";
  const synced = syncedLabel(gcal.syncedAt);
  if (gcal.phase === "reconnect")
    return "Přístup ke Google Kalendáři vypršel. Připoj ho znovu, události zatím zůstávají z posledního načtení.";
  if (gcal.phase === "offline")
    return synced
      ? `Bez spojení. Události jsou z posledního načtení ${synced}.`
      : "Bez spojení. Události se načtou, až se spojení vrátí.";
  if (gcal.phase === "error")
    return "Události se nepodařilo načíst. Zkusím to znovu za pár minut.";
  if (gcal.phase === "loading" || !synced) return "Načítám kalendáře…";
  return gcal.account
    ? `Připojeno jako ${gcal.account}. Načteno ${synced}.`
    : `Připojeno. Načteno ${synced}.`;
}

export function GcalPanel() {
  const gcal = useGcal();
  const ui = useUi();
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-2xl">Google Kalendář</h2>
      <p className="text-sm text-muted" role="status">
        {statusText(gcal)}
      </p>
      {!gcal.connected && gcal.phase !== "unconfigured" && (
        <Button tone="solid" className="w-fit" onClick={connectGcal}>
          Připojit Google Kalendář
        </Button>
      )}
      {gcal.connected && (
        <>
          <div className="flex flex-wrap gap-2">
            {gcal.phase === "reconnect" && (
              <Button tone="solid" onClick={connectGcal}>
                Připojit znovu
              </Button>
            )}
            <Button
              disabled={gcal.busy}
              onClick={() => {
                refreshGcal();
                syncGcalNow();
              }}
            >
              <RefreshCw size={14} className={cx(gcal.busy && "animate-spin")} />
              Načíst znovu
            </Button>
            <Button
              tone="danger"
              onClick={() =>
                ui.askConfirm({
                  title: "Odpojit Google Kalendář?",
                  body: "Události z Googlu z tohoto zařízení zmizí a úkoly se přestanou synchronizovat. Kalendář Ordo v Googlu zůstane, smazat ho můžeš v nastavení Google Kalendáře.",
                  confirm: "Odpojit",
                  onConfirm: () => void disconnectGcal(),
                })
              }
            >
              Odpojit
            </Button>
          </div>
          <PushSection />
          {readableCalendars(gcal).length > 0 && (
            <fieldset className="grid gap-0.5">
              <legend className="mb-1 text-sm font-medium">
                Které kalendáře ukazovat
              </legend>
              {readableCalendars(gcal).map((calendar) => (
                <label
                  key={calendar.id}
                  className={cx("flex items-center gap-3 px-1 py-1.5", hoverRow)}
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={isCalendarShown(gcal, calendar)}
                    onChange={(event) =>
                      setCalendarShown(calendar.id, event.target.checked)
                    }
                  />
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-sm bg-muted"
                    style={calendar.color ? { background: calendar.color } : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {calendar.name}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

function taskCount(count: number): string {
  if (count === 1) return "1 úkol";
  if (count >= 2 && count <= 4) return `${count} úkoly`;
  return `${count} úkolů`;
}

function pushStatus(push: PushView): string {
  if (push.phase === "waiting") return "Čeká na spojení s Google Kalendářem.";
  if (push.phase === "offline")
    return "Bez spojení. Změny úkolů se pošlou, až se spojení vrátí.";
  if (push.phase === "error")
    return "Synchronizace úkolů se nepovedla. Zkusím to znovu za chvíli.";
  if (push.phase === "syncing" && !push.syncedAt) return "Zakládám kalendář Ordo a posílám úkoly…";
  const synced = syncedLabel(push.syncedAt);
  const parts = [
    `V kalendáři Ordo je ${taskCount(push.count)}.`,
    synced ? `Synchronizováno ${synced}.` : null,
    push.pending > 0 ? `Zbývá poslat ${push.pending}.` : null,
    push.failed > 0 ? `${taskCount(push.failed)} se nepodařilo zapsat.` : null,
  ];
  return parts.filter(Boolean).join(" ");
}

function PushSection() {
  const push = usePush();
  return (
    <div className="grid gap-2 rounded-md bg-black/[0.03] px-3 py-3 dark:bg-white/[0.04]">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0"
          checked={push.enabled}
          onChange={(event) => setGcalPushEnabled(event.target.checked)}
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Synchronizovat úkoly do kalendáře Ordo</span>
          <span className="text-sm text-muted">
            Úkoly s termínem nebo plánem se objeví v kalendáři Ordo v Googlu.
            Přejmenování a posun v Googlu se vrátí do úkolu, smazání události
            přesune úkol do koše. Hotové úkoly zůstanou s fajfkou.
          </span>
        </span>
      </label>
      {push.enabled && (
        <p className="pl-7 text-sm text-muted" role="status">
          {pushStatus(push)}
        </p>
      )}
    </div>
  );
}

// True when this device writes tasks into the Ordo calendar on its own, so a
// manual "add to Google Calendar" would only make a duplicate.
export function useTasksInGoogle(): boolean {
  const gcal = useGcal();
  const push = usePush();
  return gcal.connected && push.enabled;
}

// Tells the user when a task went to the trash because its event was deleted
// in Google Calendar.
export function GcalNotices() {
  const ui = useUi();
  useEffect(() => onPushNotice((text) => ui.pushToast(text)), [ui]);
  return null;
}

// A one-line warning above the calendar when Google data is stale or blocked.
export function GcalNote() {
  const gcal = useGcal();
  if (!gcal.connected) return null;
  if (gcal.phase !== "reconnect" && gcal.phase !== "offline" && gcal.phase !== "error")
    return null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-black/[0.04] px-3 py-2 text-sm text-muted dark:bg-white/[0.06]"
      role="status"
    >
      <span>{statusText(gcal)}</span>
      {gcal.phase === "reconnect" && (
        <Button tone="soft" onClick={connectGcal}>
          Připojit znovu
        </Button>
      )}
    </p>
  );
}

function nowClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function isOver(event: CalEvent, day: string, today: string, now: string) {
  if (day < today) return true;
  if (day > today || event.allDay || event.lastDay > day) return false;
  return Boolean(event.endTime && event.endTime !== "00:00" && event.endTime <= now);
}

export function GcalDayEvents({ events, day }: { events: CalEvent[]; day: string }) {
  if (events.length === 0) return null;
  const today = todayKey();
  const now = nowClock();
  return (
    <ul className="grid gap-0.5" aria-label="Události z Google Kalendáře">
      {events.map((event) => (
        <li key={event.id}>
          <EventRow event={event} day={day} over={isOver(event, day, today, now)} />
        </li>
      ))}
    </ul>
  );
}

function EventRow({ event, day, over }: { event: CalEvent; day: string; over: boolean }) {
  const time = eventTimeLabel(event, day) ?? "celý den";
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center">
        <span
          aria-hidden
          className="h-5 w-1 rounded-full bg-muted"
          style={event.color ? { background: event.color } : undefined}
        />
      </span>
      <span className="w-[6.5rem] shrink-0 py-2 text-sm tabular-nums text-muted">
        {time}
      </span>
      <span className="min-w-0 flex-1 py-2">
        <span className={cx("block truncate", over && "text-muted")}>
          {event.title}
        </span>
        {event.location && (
          <span className="mt-0.5 block truncate text-xs text-muted">
            {event.location}
          </span>
        )}
      </span>
    </>
  );
  if (!event.link)
    return <div className="flex items-start pr-1">{content}</div>;
  return (
    <a
      href={event.link}
      target="_blank"
      rel="noreferrer"
      title="Otevřít v Google Kalendáři"
      className={cx("group flex items-start pr-1", hoverRow)}
    >
      {content}
      <span className="grid size-9 shrink-0 place-items-center text-muted opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <ExternalLink size={14} />
      </span>
    </a>
  );
}

let handledReturn: string | null = null;

// /api/gcal/callback lands on /?gcal=<result>. Show the outcome once and move
// on to the page where it matters.
export function GcalReturn() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const ui = useUi();
  useEffect(() => {
    const result = new URLSearchParams(search).get("gcal");
    if (!result) {
      handledReturn = null;
      return;
    }
    if (handledReturn === search) return;
    handledReturn = search;
    ui.pushToast(acceptGcalReturn(result));
    setLocation(result === "connected" ? "/calendar" : "/settings", {
      replace: true,
    });
  }, [search]);
  return null;
}
