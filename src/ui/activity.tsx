import { useLocation } from "wouter";
import { useSnap } from "../data/store.tsx";
import type { ActivityEntry } from "../domain/activity.ts";
import { dateKey, formatDay, todayKey } from "../domain/dates.ts";
import { byId } from "../domain/db.ts";
import type { Db, Folder } from "../domain/types.ts";
import { useUi } from "./state.tsx";
import { cx, hoverRow } from "./ui.tsx";

export function ActivityPage() {
  const { db, activity } = useSnap();
  const ui = useUi();
  const [, setLocation] = useLocation();
  const today = todayKey();
  const groups = groupActivity(activity, today);
  return (
    <div>
      <h1 className="font-display text-3xl">Aktivita</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Poslední úpravy. Kliknutím otevřeš věc tak, jak je teď.
      </p>
      {groups.length === 0 && (
        <p className="text-sm text-muted">Zatím tu nic není.</p>
      )}
      <div className="grid gap-6">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-1 text-xs text-muted">{group.label}</h2>
            <div className="grid">
              {group.entries.map((entry) => {
                const open = canOpen(db, entry);
                const time = clock(entry.at);
                if (!open) {
                  return (
                    <p
                      key={entry.id}
                      className="flex min-w-0 items-baseline gap-3 py-1.5 text-sm text-muted"
                    >
                      <span className="w-12 shrink-0 tabular-nums">{time}</span>
                      <span className="min-w-0">{entry.text}</span>
                    </p>
                  );
                }
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={cx(
                      "flex min-w-0 items-baseline gap-3 py-1.5 text-left text-sm",
                      hoverRow
                    )}
                    onClick={() => openEntry(db, entry, ui, setLocation)}
                  >
                    <span className="w-12 shrink-0 text-muted tabular-nums">{time}</span>
                    <span className="min-w-0">{entry.text}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function openEntry(
  db: Db,
  entry: ActivityEntry,
  ui: ReturnType<typeof useUi>,
  setLocation: (path: string) => void
) {
  const target = entry.target;
  if (!target) return;
  ui.setMenuOpen(false);
  if (target.kind === "person") {
    ui.setGlance(null);
    ui.setFocusId(null);
    ui.setSelected(null);
    setLocation(`/people/${target.id}`);
    return;
  }
  if (target.kind === "folder") {
    const folder = byId(db.folders, target.id);
    ui.setGlance(null);
    ui.setFocusId(null);
    ui.setSelected(null);
    setLocation(folder && !folder.isDeleted ? folderHref(folder) : "/trash");
    return;
  }
  openLinkedItem(db, target.id, ui, setLocation);
}

export function openLinkedItem(
  db: Db,
  id: string,
  ui: ReturnType<typeof useUi>,
  setLocation: (path: string) => void
) {
  ui.setMenuOpen(false);
  const item = byId(db.items, id);
  if (!item || item.isDeleted) {
    ui.setGlance(null);
    ui.setFocusId(null);
    ui.setSelected(null);
    setLocation("/trash");
    return;
  }
  const folder = byId(db.folders, item.folderId);
  if (!folder || folder.isDeleted) {
    ui.setGlance(null);
    ui.setFocusId(null);
    ui.setSelected(null);
    setLocation("/trash");
    return;
  }
  if (item.type === "note") {
    if (folder.defaultView !== "notes")
      ui.setGlance({ folderId: folder.id, view: "notes" });
    else ui.setGlance(null);
    ui.setFocusId(item.id);
    ui.setSelected(null);
  } else {
    if (folder.defaultView === "notes")
      ui.setGlance({ folderId: folder.id, view: "list" });
    else ui.setGlance(null);
    ui.setFocusId(item.id);
    ui.setSelected(item.id);
  }
  setLocation(folderHref(folder));
}

function canOpen(db: Db, entry: ActivityEntry): boolean {
  const target = entry.target;
  if (!target) return false;
  if (target.kind === "item") return byId(db.items, target.id) !== null;
  if (target.kind === "folder") return byId(db.folders, target.id) !== null;
  const person = byId(db.people, target.id);
  return person !== null && !person.isDeleted;
}

function folderHref(folder: Folder): string {
  return folder.system === "inbox" ? "/inbox" : `/folder/${folder.id}`;
}

function groupActivity(entries: ActivityEntry[], today: string) {
  const groups: { label: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at, today);
    const last = groups.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function dayLabel(at: string, today: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const label = formatDay(dateKey(date), today);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function clock(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}
