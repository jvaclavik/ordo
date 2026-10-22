import {
  CalendarDays,
  ChevronRight,
  Columns3,
  List,
  Pencil,
  StickyNote,
} from "lucide-react";
import { nanoid } from "nanoid";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { showOtherCalendars, useGcalMonth } from "../data/gcal.ts";
import { dispatch, useSnap } from "../data/store.tsx";
import { isUntouched } from "../data/syncMap.ts";
import { isPaletteColor } from "../domain/color.ts";
import { addDays, todayKey } from "../domain/dates.ts";
import {
  byId,
  descendantFolderIds,
  inboxFolder,
  resolvedOpen,
} from "../domain/db.ts";
import { newItem } from "../domain/factory.ts";
import { viewLabel } from "../domain/labels.ts";
import { splitNoteDraft, takeNoteIntent } from "../domain/noteIntent.ts";
import { keyAtStart } from "../domain/ordering.ts";
import { opsFromTaskLines, parseQuickAdd } from "../domain/quickAdd.ts";
import {
  applyQuery,
  focusSections,
  folderItems,
  folderTrail,
  isOpenItem,
  searchItems,
  searchTags,
  shownChildFolders,
  tagItems,
  visibleItems,
} from "../domain/select.ts";
import {
  clampStickySize,
  STICKY_H,
  STICKY_W,
  stickyColumns,
  stickyPaper,
  stickySlot,
  stickyTilt,
} from "../domain/stickies.ts";
import {
  FOLDER_COLOR_LABELS,
  FOLDER_COLOR_ORDER,
  type Folder,
  type FolderPaint,
  type Item,
  type Tag,
} from "../domain/types.ts";
import { eventsOnDay } from "../lib/gcalEvents.ts";
import { CalendarBoard, PlanTargets } from "./calendar.tsx";
import {
  Dot,
  FolderChildren,
  FolderCrumbs,
  FolderGlyph,
  treePad,
} from "./folders.tsx";
import { GcalDayEvents, GcalNote } from "./gcal.tsx";
import { loadDemo } from "./guide.tsx";
import { MarkdownField, type MarkdownHandle } from "./markdownField.tsx";
import { useUi } from "./state.tsx";
import { BoardView, ItemList, ListView } from "./tasks.tsx";
import {
  Button,
  cx,
  hoverRow,
  OpenMark,
  PriorityMark,
  TagMark,
  trapTab,
  useLayer,
} from "./ui.tsx";

let captureLock = false;

export function Capture() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { db } = useSnap();
  const ui = useUi();
  useEffect(() => {
    if (location !== "/add") {
      captureLock = false;
      return;
    }
    if (captureLock) return;
    captureLock = true;
    const params = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search
    );
    const text = params.get("text") ?? "";
    const folderParam = params.get("folder");
    const due = params.get("due");
    const inbox = inboxFolder(db);
    const named = folderParam
      ? db.folders.find(
          (folder) =>
            !folder.isDeleted &&
            (folder.id === folderParam ||
              folder.name.toLocaleLowerCase("cs") ===
                folderParam.toLocaleLowerCase("cs"))
        )
      : null;
    const intent = takeNoteIntent(text);
    if (intent.note && inbox) {
      const folder = named ?? inbox;
      const draft = splitNoteDraft(intent.text);
      const home =
        folder.system === "inbox" ? "/inbox" : `/folder/${folder.id}`;
      if (!draft) {
        ui.openQuick({
          text: intent.text,
          kind: "note",
          folderId: folder.id,
        });
        setLocation(home, { replace: true });
        return;
      }
      const id = nanoid(10);
      const next = dispatch({
        type: "createItem",
        item: newItem({
          id,
          folderId: folder.id,
          title: draft.title,
          body: draft.body,
          type: "note",
          statusId: resolvedOpen(db, folder)?.id ?? null,
          applyRules: false,
        }),
      });
      if (byId(next.items, id)) {
        ui.pushToast("Poznámka uložena", true);
        ui.select(id);
      }
      setLocation(home, { replace: true });
      return;
    }
    if (!text.trim() || !inbox) {
      ui.openQuick({ text });
      setLocation("/inbox", { replace: true });
      return;
    }
    const first = parseQuickAdd(text, db, todayKey());
    const folder =
      byId(db.folders, first.folderId ?? named?.id ?? inbox.id) ?? inbox;
    const { ops, itemIds } = opsFromTaskLines(db, text, {
      folderId: folder.id,
      statusId: resolvedOpen(db, folder)?.id ?? null,
      dateRole: "due",
      applyRules: folder.system === "inbox",
      ids: () => nanoid(10),
      today: todayKey(),
    });
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
      for (const id of itemIds)
        ops.push({
          type: "updateItem",
          id,
          patch: {
            dueAt: due,
            dueHasTime: false,
            plannedFor: null,
            planUntil: null,
          },
        });
    }
    const next = dispatch({ type: "batch", ops });
    const created = itemIds.flatMap((id) => {
      const item = byId(next.items, id);
      return item ? [item] : [];
    });
    const moved = created.filter((item) => item.folderId !== inbox.id);
    if (folder.system === "inbox" && moved.length === 1) {
      const home = byId(next.folders, moved[0]?.folderId ?? null);
      if (home) ui.pushToast(`Zařazeno do ${home.name}`, true);
    } else if (folder.system === "inbox" && moved.length > 1) {
      ui.pushToast("Zařazeno podle pravidel.", true);
    }
    const only = created.length === 1 ? created[0] : null;
    ui.select(only?.id ?? null);
    const homeId = only?.folderId ?? folder.id;
    setLocation(homeId === inbox.id ? "/inbox" : `/folder/${homeId}`, {
      replace: true,
    });
  }, [location, search, db, ui, setLocation]);
  return null;
}

export function HomePage() {
  const ui = useUi();
  const today = todayKey();
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Domů</h1>
        <button
          type="button"
          className="text-sm text-muted! hover:text-ink!"
          onClick={() => ui.setFolderEdit({ id: null, parentId: null })}
        >
          Nová složka
        </button>
      </div>
      <EmptyWelcome />
      <RecentTasks />
      <HomeTree today={today} />
    </div>
  );
}

function EmptyWelcome() {
  const { db } = useSnap();
  const ui = useUi();
  const inbox = inboxFolder(db);
  if (!isUntouched(db) || !inbox) return null;
  return (
    <section className="mb-8 rounded-xl border border-line bg-panel px-4 py-4">
      <h2 className="font-display text-2xl">Zatím tu nic není</h2>
      <p className="mt-1 mb-3 max-w-xl text-sm text-muted">
        Naplň ukázkou, ať je vidět složky, nástěnka, kalendář, opakování a
        návrhy. Až ji nebudeš chtít, v nastavení všechna data smažeš.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="solid"
          onClick={() => {
            loadDemo(inbox.id);
            ui.pushToast("Ukázka je naplněná", true);
          }}
        >
          Naplň ukázkou
        </Button>
        <Link
          href="/pruvodce"
          className="inline-flex items-center rounded-md bg-black/[0.04] px-3 py-1.5 text-sm font-medium hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
        >
          Co Ordo umí
        </Link>
      </div>
    </section>
  );
}

function RecentTasks() {
  const { db } = useSnap();
  const items = visibleItems(db)
    .filter(
      (item) =>
        item.type === "task" && !item.parentItemId && isOpenItem(db, item)
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-1 px-1 text-sm text-muted">Poslední úkoly</h2>
      <ItemList items={items} showFolder />
    </section>
  );
}

function HomeTree({ today }: { today: string }) {
  const { db } = useSnap();
  const ui = useUi();
  const folders = shownChildFolders(db, null, ui.showHidden);
  if (folders.length === 0) {
    return <p className="text-sm text-muted">Zatím tu žádná složka není.</p>;
  }
  return (
    <div>
      {folders.map((folder) => (
        <HomeFolder key={folder.id} folder={folder} depth={0} today={today} />
      ))}
    </div>
  );
}

function HomeFolder({
  folder,
  depth,
  today,
}: {
  folder: Folder;
  depth: number;
  today: string;
}) {
  const { db } = useSnap();
  const ui = useUi();
  const [location] = useLocation();
  const [open, setOpen] = useState(depth < 1);
  const children = shownChildFolders(db, folder.id, ui.showHidden);
  const href = folder.system === "inbox" ? "/inbox" : `/folder/${folder.id}`;
  const active = location === href;
  const tasks = folderItems(db, folder.id, true).filter(
    (item) => item.type === "task" && isOpenItem(db, item)
  );
  const overdue = tasks.filter(
    (item) => item.dueAt && item.dueAt.slice(0, 10) < today
  ).length;
  const dueToday = tasks.filter(
    (item) => item.dueAt?.slice(0, 10) === today
  ).length;
  const parts: string[] = [];
  if (overdue > 0)
    parts.push(overdue === 1 ? "1 po termínu" : `${overdue} po termínu`);
  if (dueToday > 0)
    parts.push(dueToday === 1 ? "1 na dnešek" : `${dueToday} na dnešek`);
  useEffect(() => {
    if (!location.startsWith("/folder/")) return;
    const currentId = location.slice("/folder/".length);
    if (currentId === folder.id) return;
    if (folderTrail(db, currentId).some((entry) => entry.id === folder.id))
      setOpen(true);
  }, [location, folder.id]);
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
        style={{ paddingLeft: treePad(depth) }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted! hover:bg-black/10 hover:text-ink! dark:hover:bg-white/15"
            aria-expanded={open}
            aria-label={open ? "Sbalit" : "Rozbalit"}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight
              size={16}
              className={cx("transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-3"
          onClick={(event) => {
            if (children.length > 0 && active) {
              event.preventDefault();
              setOpen((value) => !value);
              return;
            }
            if (children.length > 0) setOpen(true);
          }}
        >
          <Dot color={folder.color} icon={folder.icon} />
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                "block truncate",
                depth === 0 && "font-medium",
                folder.hidden && "text-muted"
              )}
            >
              {folder.name}
            </span>
            {parts.length > 0 && (
              <span className="block truncate text-xs text-muted">
                {parts.join(" · ")}
              </span>
            )}
          </span>
          {tasks.length > 0 && (
            <span className="text-xs tabular-nums text-muted">
              {tasks.length}
            </span>
          )}
        </Link>
      </div>
      {open &&
        children.map((child) => (
          <HomeFolder
            key={child.id}
            folder={child}
            depth={depth + 1}
            today={today}
          />
        ))}
    </div>
  );
}

function countLabel(count: number, one: string, few: string, many: string) {
  if (count === 1) return `1 ${one}`;
  return `${count} ${count < 5 ? few : many}`;
}

const FOCUS_TITLE = {
  overdue: "Po termínu",
  today: "Dnes",
  soon: "Do týdne",
  priority: "Vysoká priorita",
  ready: "Můžu začít",
} as const;

export function TodayPage() {
  const { db } = useSnap();
  const today = todayKey();
  const sections = focusSections(db, today);
  const monthEvents = useGcalMonth(today.slice(0, 7));
  const events = showOtherCalendars() ? eventsOnDay(monthEvents, today) : [];
  return (
    <div>
      <h1 className="mb-4 font-display text-3xl">Dnes</h1>
      <PlanTargets />
      <GcalNote />
      {events.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 px-1 text-sm text-muted">V kalendáři</h2>
          <GcalDayEvents events={events} day={today} />
        </section>
      )}
      {sections.length === 0 && events.length === 0 && (
        <p className="px-2 text-sm text-muted">Teď tu nic není.</p>
      )}
      {sections.map((section) => (
        <section key={section.id} className="mb-5">
          <h2 className="mb-1 px-1 text-sm text-muted">
            {FOCUS_TITLE[section.id]}
          </h2>
          <ItemList items={section.items} showFolder />
        </section>
      ))}
      <p className="mt-4 text-xs text-muted">
        Zítřek je {addDays(today, 1)}. Přetažení na den nastaví plán a zruší
        přesný termín.
      </p>
    </div>
  );
}

export function InboxPage() {
  const { db } = useSnap();
  const ui = useUi();
  const inbox = inboxFolder(db);
  useEffect(() => {
    const current = inboxFolder(db);
    if (!current) return;
    const before = new Set(
      folderItems(db, current.id, false).map((item) => item.id)
    );
    const next = dispatch({ type: "sortInbox" });
    const afterFolder = inboxFolder(next);
    if (!afterFolder) return;
    const after = new Set(
      folderItems(next, afterFolder.id, false).map((item) => item.id)
    );
    let moved = 0;
    for (const id of before) if (!after.has(id)) moved += 1;
    if (moved > 0) {
      ui.pushToast(
        `${countLabel(
          moved,
          "položka zařazena",
          "položky zařazeny",
          "položek zařazeno"
        )} podle pravidel.`,
        true
      );
    }
    // Při dalším překreslení by vrácený krok hned znovu zařadil.
  }, []);
  if (!inbox) return null;
  return (
    <FolderScreen
      folder={inbox}
      intro={
        <p className="mt-1 text-sm text-muted">
          Sem patří všechno, co ještě nemá své místo.{" "}
          <Link
            href="/settings#pravidla"
            className="text-ink underline decoration-line underline-offset-2"
          >
            Pravidla
          </Link>
        </p>
      }
    />
  );
}

function FolderScreen({
  folder,
  intro,
}: {
  folder: Folder;
  intro?: ReactNode;
}) {
  const { db } = useSnap();
  const ui = useUi();
  const view = folder.defaultView;
  const items = folderItems(db, folder.id, false);
  const nested = descendantFolderIds(db, folder.id)
    .map((id) => byId(db.folders, id))
    .filter(
      (entry): entry is NonNullable<typeof entry> =>
        entry !== null && !entry.isDeleted && !entry.isArchived
    );
  const notes = items.filter((item) => item.type === "note");
  const tasks = items.filter((item) => item.type === "task");
  return (
    <div
      className={
        view === "board" ? "flex min-h-0 min-w-0 flex-1 flex-col" : undefined
      }
    >
      <div className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <FolderCrumbs folderId={folder.id} parentsOnly />
          <div className="flex items-center gap-2.5">
            <FolderGlyph color={folder.color} className="h-10" />
            <h1 className="font-display text-3xl">
              {folder.icon ? `${folder.icon} ` : ""}
              {folder.name}
            </h1>
            <button
              type="button"
              aria-label="Upravit"
              title="Upravit"
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
              onClick={() =>
                ui.setFolderEdit({ id: folder.id, parentId: folder.parentId })
              }
            >
              <Pencil size={16} />
            </button>
          </div>
          {intro}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-black/5 p-0.5 dark:bg-white/10">
            {(
              [
                ["list", List],
                ["board", Columns3],
                ["notes", StickyNote],
                ["calendar", CalendarDays],
              ] as const
            ).map(([mode, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-label={viewLabel(mode)}
                title={viewLabel(mode)}
                aria-pressed={view === mode}
                className={cx(
                  "grid size-8 place-items-center rounded-sm",
                  view === mode
                    ? "bg-accent text-accent-ink"
                    : "text-muted hover:text-ink"
                )}
                onClick={() =>
                  dispatch({
                    type: "updateFolder",
                    id: folder.id,
                    patch: { defaultView: mode },
                  })
                }
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {view === "list" && (
        <>
          <FolderChildren parentId={folder.id} />
          <ListView folder={folder} items={tasks} />
        </>
      )}
      {view === "board" && <BoardView folder={folder} />}
      {view === "notes" && <Notes folderId={folder.id} notes={notes} />}
      {view === "calendar" && (
        <CalendarBoard
          folderId={folder.id}
          items={visibleItems(db).filter(
            (item) =>
              item.folderId === folder.id ||
              nested.some((entry) => entry.id === item.folderId)
          )}
        />
      )}
    </div>
  );
}

export function FolderPage() {
  const params = useParams<{ id: string }>();
  const { db } = useSnap();
  const folder = byId(db.folders, params.id ?? null);
  if (!folder || folder.isDeleted) return <p>Složka tu není.</p>;
  return <FolderScreen folder={folder} />;
}

function noteSource(note: { title: string; body: string | null }) {
  const body = note.body?.replace(/\r\n/g, "\n") ?? "";
  if (!body) return note.title;
  const first = body.split("\n", 1)[0] ?? "";
  const plain = first.replace(/^#{1,6}\s+/, "").trim();
  if (plain === note.title) return body;
  return `${note.title}\n${body}`;
}

function NoteTask({ id }: { id: string }) {
  const { db } = useSnap();
  return (
    <p className="text-sm text-muted">
      {byId(db.items, id)?.title ?? "Úkol už tu není."}
    </p>
  );
}

function noteParts(value: string) {
  const text = value.replace(/\r\n/g, "\n");
  const breakAt = text.indexOf("\n");
  if (breakAt === -1) return { title: text, body: "" };
  return { title: text.slice(0, breakAt), body: text.slice(breakAt + 1) };
}

function noteText(title: string, body: string) {
  if (!body) return title;
  return `${title}\n${body}`;
}

function NoteRead({ source }: { source: string }) {
  const { title, body } = noteParts(source);
  const heading = title.replace(/^#{1,6}\s+/, "");
  return (
    <div className="grid gap-1">
      {heading.trim() && (
        <div className="note-title break-words">{heading}</div>
      )}
      {body.trim() && (
        <MarkdownField
          value={body}
          editable={false}
          embed={(id) => <NoteTask id={id} />}
        />
      )}
    </div>
  );
}

function NoteField({
  value,
  label,
  autoFocus = false,
  onDone,
}: {
  value: string;
  label: string;
  autoFocus?: boolean;
  onDone: (next: string | null) => void;
}) {
  const start = noteParts(value);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<MarkdownHandle>(null);
  const titleValue = useRef(start.title);
  const bodyValue = useRef(start.body);
  const skip = useRef(false);
  const done = useRef(false);
  const [title, setTitle] = useState(start.title);
  const [body, setBody] = useState(start.body);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  const textNow = () => noteText(titleValue.current, bodyValue.current);
  return (
    <div className="grid gap-1">
      <div>
        <input
          ref={titleRef}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder="Nadpis"
          className="note-title block w-full border-0 bg-transparent p-0 outline-none placeholder:text-[#6d6456]"
          value={title}
          onChange={(event) => {
            titleValue.current = event.target.value;
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              skip.current = true;
              event.currentTarget.blur();
              return;
            }
            if (event.nativeEvent.isComposing) return;
            if (
              event.key === "ArrowDown" &&
              !event.shiftKey &&
              !event.altKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              event.preventDefault();
              bodyRef.current?.focus(event.currentTarget.selectionStart ?? 0);
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            bodyRef.current?.focus();
          }}
          onBlur={() => {
            window.setTimeout(() => {
              const active = document.activeElement;
              const box = titleRef.current?.closest(".grid");
              if (active instanceof Node && box?.contains(active)) return;
              finish(skip.current ? null : textNow());
            }, 0);
          }}
        />
      </div>
      <MarkdownField
        ref={bodyRef}
        value={body}
        label="Text poznámky"
        placeholder="Text…"
        onChange={(next) => {
          bodyValue.current = next;
          setBody(next);
        }}
        onEscape={() => {
          skip.current = true;
        }}
        embed={(id) => <NoteTask id={id} />}
        onExit={(dir, column) => {
          if (dir > 0) return;
          const input = titleRef.current;
          if (!input) return;
          const at = Math.min(column, input.value.length);
          input.focus();
          input.setSelectionRange(at, at);
        }}
        onBlur={() => {
          window.setTimeout(() => {
            const active = document.activeElement;
            if (
              active instanceof Node &&
              titleRef.current?.closest(".grid")?.contains(active)
            )
              return;
            finish(skip.current ? null : textNow());
          }, 0);
        }}
      />
    </div>
  );
}

function Notes({
  folderId,
  notes,
}: {
  folderId: string;
  notes: ReturnType<typeof folderItems>;
}) {
  const { db } = useSnap();
  const board = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const folder = byId(db.folders, folderId);
  const statusId = folder ? resolvedOpen(db, folder)?.id ?? null : null;
  useLayoutEffect(() => {
    const node = board.current;
    if (!node) return;
    const measure = () => setColumns(stickyColumns(node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = board.current;
    if (!node) return;
    let bottom = 480;
    for (const card of node.querySelectorAll<HTMLElement>("[data-sticky]")) {
      bottom = Math.max(bottom, card.offsetTop + card.offsetHeight + 28);
    }
    node.style.height = `${bottom}px`;
  });
  const create = (text: string) => {
    const parsed = splitNoteDraft(text);
    if (!parsed) return;
    dispatch({
      type: "createItem",
      item: newItem({
        id: nanoid(10),
        folderId,
        title: parsed.title,
        body: parsed.body,
        type: "note",
        statusId,
        sortOrder: keyAtStart(notes.map((note) => note.sortOrder)),
      }),
    });
  };
  const drop = (id: string, x: number, y: number) => {
    const pinZ =
      notes.reduce((max, note) => Math.max(max, note.pinZ ?? 0), 0) + 1;
    dispatch({
      type: "updateItem",
      id,
      patch: {
        pinX: Math.round(Math.max(0, x)),
        pinY: Math.round(Math.max(0, y)),
        pinZ,
      },
    });
  };
  const composerAt = stickySlot(0, columns);
  return (
    <div ref={board} className="relative mt-1 min-h-[32rem]">
      <NoteComposer x={composerAt.x} y={composerAt.y} onCommit={create} />
      {notes.map((note, index) => {
        const auto = stickySlot(index + 1, columns);
        return (
          <StickyCard
            key={note.id}
            note={note}
            source={noteSource(note)}
            x={note.pinX ?? auto.x}
            y={note.pinY ?? auto.y}
            z={(note.pinZ ?? index) + 2}
            onDrop={drop}
            onCommit={(text) => {
              const parsed = splitNoteDraft(text);
              if (!parsed) return;
              if (parsed.title === note.title && parsed.body === note.body)
                return;
              dispatch({
                type: "updateItem",
                id: note.id,
                patch: { title: parsed.title, body: parsed.body },
                fileInbox: true,
              });
            }}
            onResize={(width, height) => {
              if (note.pinW === width && note.pinH === height) return;
              dispatch({
                type: "updateItem",
                id: note.id,
                patch: { pinW: width, pinH: height },
              });
            }}
          />
        );
      })}
    </div>
  );
}

function NoteComposer({
  x,
  y,
  onCommit,
}: {
  x: number;
  y: number;
  onCommit: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<MarkdownHandle>(null);
  const titleValue = useRef("");
  const bodyValue = useRef("");
  const committed = useRef<string | null>(null);
  const skip = useRef(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const commit = () => {
    if (skip.current) return;
    const text = noteText(titleValue.current, bodyValue.current);
    if (committed.current === text) return;
    if (!splitNoteDraft(text)) return;
    committed.current = text;
    titleValue.current = "";
    bodyValue.current = "";
    setTitle("");
    setBody("");
    onCommit(text);
  };
  const leave = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof Node && box.current?.contains(active)) return;
      if (skip.current) {
        skip.current = false;
        return;
      }
      commit();
    }, 0);
  };
  return (
    <div
      ref={box}
      data-sticky=""
      className="sticky-note absolute min-h-[148px] rounded-sm px-4 pt-5 pb-4"
      style={{
        left: x,
        top: y,
        width: STICKY_W,
        background: "#f4e4a6",
        zIndex: 1,
      }}
    >
      <span
        className="absolute inset-x-0 top-0 h-2"
        style={{ background: "#e6cf7c" }}
      />
      <div className="grid gap-1">
        <div>
          <input
            ref={titleRef}
            autoFocus
            aria-label="Nadpis"
            placeholder="Nadpis"
            data-note-composer=""
            className="note-title block w-full border-0 bg-transparent p-0 outline-none placeholder:text-[#6d6456]"
            value={title}
            onChange={(event) => {
              committed.current = null;
              titleValue.current = event.target.value;
              setTitle(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                skip.current = true;
                setTitle("");
                setBody("");
                event.currentTarget.blur();
                return;
              }
              if (event.nativeEvent.isComposing) return;
              if (
                event.key === "ArrowDown" &&
                !event.shiftKey &&
                !event.altKey &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                bodyRef.current?.focus(event.currentTarget.selectionStart ?? 0);
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              bodyRef.current?.focus();
            }}
            onBlur={leave}
          />
        </div>
        <MarkdownField
          ref={bodyRef}
          value={body}
          label="Text poznámky"
          placeholder="Text…"
          className="min-h-16"
          onChange={(next) => {
            committed.current = null;
            bodyValue.current = next;
            setBody(next);
          }}
          onEscape={() => {
            skip.current = true;
            setTitle("");
            setBody("");
          }}
          embed={(id) => <NoteTask id={id} />}
          onExit={(dir, column) => {
            if (dir > 0) return;
            const input = titleRef.current;
            if (!input) return;
            const at = Math.min(column, input.value.length);
            input.focus();
            input.setSelectionRange(at, at);
          }}
          onBlur={leave}
        />
      </div>
    </div>
  );
}

function StickyCard({
  note,
  source,
  x,
  y,
  z,
  onCommit,
  onDrop,
  onResize,
}: {
  note: Item;
  source: string;
  x: number;
  y: number;
  z: number;
  onCommit: (text: string) => void;
  onDrop: (id: string, x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const origin = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
  } | null>(null);
  const place = useRef<{ x: number; y: number } | null>(null);
  const resize = useRef<{
    px: number;
    py: number;
    w: number;
    h: number;
  } | null>(null);
  const moved = useRef(false);
  const ignoreClick = useRef(false);
  const paper = stickyPaper(note.id);
  const left = drag?.x ?? x;
  const top = drag?.y ?? y;
  const width = live?.w ?? note.pinW ?? STICKY_W;
  const height = live?.h ?? note.pinH ?? null;
  useEffect(() => {
    if (!drag) return;
    if (
      Math.round(x) === Math.round(drag.x) &&
      Math.round(y) === Math.round(drag.y)
    )
      setDrag(null);
  }, [x, y, drag]);
  useEffect(() => {
    if (!live) return;
    if (note.pinW === live.w && note.pinH === live.h) setLive(null);
  }, [note.pinW, note.pinH, live]);
  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || editing) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "a, textarea, input, button, [contenteditable='true'], [data-resize]"
      )
    )
      return;
    origin.current = { px: event.clientX, py: event.clientY, x: left, y: top };
    place.current = { x: left, y: top };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = card.current?.getBoundingClientRect();
    if (!rect) return;
    resize.current = {
      px: event.clientX,
      py: event.clientY,
      w: rect.width,
      h: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return (
    <article
      ref={card}
      data-note=""
      data-sticky=""
      className={cx(
        "sticky-note absolute flex flex-col rounded-sm px-4 pt-5 pb-6",
        height === null ? "min-h-[148px]" : "overflow-hidden",
        drag ? "cursor-grabbing" : editing ? "cursor-text" : "cursor-grab",
        !editing && "touch-none select-none"
      )}
      style={{
        left,
        top,
        width,
        height: height ?? undefined,
        zIndex: drag || live ? 50 : z,
        background: paper.bg,
        transform: drag
          ? "rotate(0deg) scale(1.03)"
          : `rotate(${stickyTilt(note.id)}deg)`,
      }}
      onPointerDown={beginDrag}
      onPointerMove={(event) => {
        const start = origin.current;
        if (!start) return;
        const dx = event.clientX - start.px;
        const dy = event.clientY - start.py;
        if (!moved.current && Math.hypot(dx, dy) < 6) return;
        moved.current = true;
        const next = {
          x: Math.max(0, start.x + dx),
          y: Math.max(0, start.y + dy),
        };
        place.current = next;
        setDrag(next);
      }}
      onPointerUp={() => {
        const next = place.current;
        const didMove = moved.current;
        origin.current = null;
        moved.current = false;
        if (!didMove || !next) return;
        ignoreClick.current = true;
        onDrop(note.id, next.x, next.y);
      }}
      onPointerCancel={() => {
        origin.current = null;
        place.current = null;
        moved.current = false;
        setDrag(null);
      }}
      onClick={(event) => {
        if (ignoreClick.current) {
          ignoreClick.current = false;
          return;
        }
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(
            "a, textarea, input, button, [contenteditable='true'], [data-resize]"
          )
        )
          return;
        setEditing(true);
      }}
    >
      <span
        className="absolute inset-x-0 top-0 h-2"
        style={{ background: paper.edge }}
      />
      <div className={cx("min-h-0", height !== null && "flex-1 overflow-auto")}>
        {editing ? (
          <NoteField
            value={source}
            label="Nadpis"
            autoFocus
            onDone={(text) => {
              setEditing(false);
              if (text === null || text.trim() === source.trim()) return;
              onCommit(text);
            }}
          />
        ) : (
          <NoteRead source={source} />
        )}
      </div>
      <div
        data-resize=""
        role="button"
        aria-label="Velikost poznámky"
        className="absolute right-0 bottom-0 z-10 grid size-6 cursor-nwse-resize touch-none place-items-end p-1"
        onPointerDown={beginResize}
        onPointerMove={(event) => {
          const start = resize.current;
          if (!start) return;
          event.stopPropagation();
          const next = clampStickySize(
            start.w + event.clientX - start.px,
            start.h + event.clientY - start.py
          );
          setLive({ w: next.width, h: next.height });
        }}
        onPointerUp={(event) => {
          const start = resize.current;
          resize.current = null;
          if (!start) return;
          event.stopPropagation();
          const next = clampStickySize(
            start.w + event.clientX - start.px,
            start.h + event.clientY - start.py
          );
          if (
            next.width === Math.round(start.w) &&
            next.height === Math.round(start.h)
          ) {
            setLive(null);
            return;
          }
          setLive({ w: next.width, h: next.height });
          onResize(next.width, next.height);
        }}
        onPointerCancel={() => {
          resize.current = null;
          setLive(null);
        }}
        onKeyDown={(event) => {
          const horizontal =
            event.key === "ArrowRight"
              ? 16
              : event.key === "ArrowLeft"
              ? -16
              : 0;
          const vertical =
            event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0;
          if (!horizontal && !vertical) return;
          event.preventDefault();
          event.stopPropagation();
          const current = clampStickySize(
            width,
            height ?? card.current?.offsetHeight ?? STICKY_H
          );
          const next = clampStickySize(
            current.width + horizontal,
            current.height + vertical
          );
          setLive({ w: next.width, h: next.height });
          onResize(next.width, next.height);
        }}
      >
        <span className="size-2.5 border-r-2 border-b-2 border-[#2a241c]/40" />
      </div>
    </article>
  );
}

export function TrashPage() {
  const { db } = useSnap();
  const ui = useUi();
  const items = db.items.filter((item) => item.isDeleted);
  const folders = db.folders.filter((folder) => folder.isDeleted);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl">Koš</h1>
        <Button
          tone="danger"
          onClick={() =>
            ui.askConfirm({
              title: "Vyprázdnit koš?",
              body: "Smazané položky zmizí nadobro.",
              confirm: "Vyprázdnit",
              onConfirm: () => dispatch({ type: "emptyTrash" }),
            })
          }
        >
          Vyprázdnit
        </Button>
      </div>
      {items.length === 0 && folders.length === 0 && (
        <p className="text-sm text-muted">Koš je prázdný.</p>
      )}
      {folders.map((folder) => (
        <TrashRow
          key={folder.id}
          title={folder.name}
          onRestore={() => dispatch({ type: "restoreFolder", id: folder.id })}
          onPurge={() => {
            dispatch({ type: "purgeFolder", id: folder.id });
            ui.pushToast(`Složka „${folder.name}“ je smazaná natrvalo`, true);
          }}
        />
      ))}
      {items.map((item) => (
        <TrashRow
          key={item.id}
          title={item.title.trim() || "Bez názvu"}
          onRestore={() => dispatch({ type: "restoreItem", id: item.id })}
          onPurge={() => {
            dispatch({ type: "purgeItem", id: item.id });
            ui.pushToast(
              `„${item.title.trim() || "Bez názvu"}“ je smazané natrvalo`,
              true
            );
          }}
        />
      ))}
    </div>
  );
}

function TrashRow({
  title,
  onRestore,
  onPurge,
}: {
  title: string;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 truncate">{title}</span>
      <span className="flex shrink-0 gap-1">
        <Button onClick={onRestore}>Obnovit</Button>
        <Button tone="danger" onClick={onPurge}>
          Smazat
        </Button>
      </span>
    </div>
  );
}

function tagSwatch(color: string | null) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#767676";
}

function TagColor({ tag }: { tag: Tag }) {
  const paint = (color: FolderPaint | null) =>
    dispatch({ type: "updateTag", id: tag.id, color });
  const custom = Boolean(tag.color && !isPaletteColor(tag.color));
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {FOLDER_COLOR_ORDER.map((value) => (
        <button
          key={value}
          type="button"
          aria-label={FOLDER_COLOR_LABELS[value]}
          aria-pressed={tag.color === value}
          title={FOLDER_COLOR_LABELS[value]}
          className={cx(
            "size-6 rounded-full",
            tag.color === value &&
              "outline outline-2 outline-offset-2 outline-ink"
          )}
          style={{ background: `var(--${value})` }}
          onClick={() => paint(tag.color === value ? null : value)}
        />
      ))}
      <input
        type="color"
        aria-label="Vlastní barva"
        title="Vlastní barva"
        className={cx(
          "h-7 w-10 cursor-pointer rounded-md border border-line bg-transparent p-0.5",
          "[&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0",
          custom && "outline outline-2 outline-offset-2 outline-ink"
        )}
        value={tagSwatch(tag.color)}
        onChange={(event) => {
          const next = event.target.value;
          if (/^#[0-9a-fA-F]{6}$/.test(next))
            paint(next.toLowerCase() as FolderPaint);
        }}
      />
    </div>
  );
}

export function TagPage() {
  const params = useParams<{ id: string }>();
  const { db } = useSnap();
  const tag = byId(db.tags, params.id ?? null);
  if (!tag || tag.isDeleted) return <p>Štítek tu není.</p>;
  const items = tagItems(db, tag.id);
  return (
    <div>
      <h1 className="mb-3 font-display text-3xl">
        <TagMark name={tag.name} color={tag.color} dotClassName="size-4" />
      </h1>
      <TagColor tag={tag} />
      {items.length === 0 ? (
        <p className="text-sm text-muted">Pod tímhle štítkem nic není.</p>
      ) : (
        <ItemList items={items} showFolder />
      )}
    </div>
  );
}

export function ViewPage() {
  const params = useParams<{ id: string }>();
  const { db } = useSnap();
  const view = db.savedViews.find(
    (entry) => entry.id === params.id && !entry.isDeleted
  );
  if (!view) return <p>Pohled tu není.</p>;
  const items = applyQuery(db, view.query);
  return (
    <div>
      <h1 className="mb-4 font-display text-3xl">{view.name}</h1>
      <ItemList items={items} showFolder />
    </div>
  );
}

export function SearchDialog() {
  const ui = useUi();
  if (!ui.searchOpen) return null;
  return <SearchPanel />;
}

function SearchPanel() {
  const { db } = useSnap();
  const ui = useUi();
  const [, setLocation] = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const needle = text.trim().toLocaleLowerCase("cs");
  const folders = needle
    ? db.folders
        .filter(
          (folder) =>
            !folder.isDeleted &&
            folder.name.toLocaleLowerCase("cs").includes(needle)
        )
        .slice(0, 6)
    : [];
  const tags = searchTags(db, text);
  const items = searchItems(db, text);
  const hits = [
    ...folders.map((folder) => ({
      kind: "folder" as const,
      id: folder.id,
      label: folderTrail(db, folder.id)
        .map((part) => part.name)
        .join(" / "),
      href: folder.system === "inbox" ? "/inbox" : `/folder/${folder.id}`,
    })),
    ...tags.map((tag) => ({
      kind: "tag" as const,
      id: tag.id,
      name: tag.name,
      color: tag.color,
      label: `#${tag.name}`,
      href: `/tag/${tag.id}`,
    })),
    ...items.map((item) => ({
      kind: "item" as const,
      id: item.id,
      label: item.title,
      priority: item.priority,
      href: "",
    })),
  ];
  const active = hits.length === 0 ? 0 : Math.min(index, hits.length - 1);
  const openHit = (hit: (typeof hits)[number]) => {
    if (hit.kind === "item") ui.setSelected(hit.id);
    else {
      setLocation(hit.href);
      ui.select(null);
    }
    ui.setMenuOpen(false);
    ui.setSearchOpen(false);
  };
  useLayer((event) => {
    trapTab(event, panel.current);
    if (event.key === "Escape") {
      event.preventDefault();
      ui.setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const last = hits.length - 1;
      if (last < 0) return;
      setIndex((current) => {
        const from = Math.min(current, last);
        return event.key === "ArrowDown"
          ? Math.min(last, from + 1)
          : Math.max(0, from - 1);
      });
      return;
    }
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("a, button")) return;
    const hit = hits[active];
    if (!hit) return;
    event.preventDefault();
    openHit(hit);
  });
  useEffect(() => {
    document
      .getElementById(`search-hit-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, text]);
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/15 p-4"
      onMouseDown={() => ui.setSearchOpen(false)}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Hledat"
        className="mx-auto max-w-lg rounded-lg bg-raised p-4 outline-none"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          className="w-full bg-transparent py-2 text-lg outline-none"
          placeholder="Hledat"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setIndex(0);
          }}
        />
        <div className="max-h-80 overflow-y-auto" role="listbox">
          {hits.length === 0 && needle && (
            <p className="px-2 py-3 text-sm text-muted">Nic nenalezeno.</p>
          )}
          {hits.map((hit, hitIndex) =>
            hit.kind === "folder" || hit.kind === "tag" ? (
              <Link
                key={`${hit.kind}-${hit.id}`}
                id={`search-hit-${hitIndex}`}
                href={hit.href}
                role="option"
                aria-selected={hitIndex === active}
                className={cx(
                  "flex items-center gap-2 px-2 py-2",
                  hoverRow,
                  hitIndex === active && "bg-accent-soft text-accent"
                )}
                onMouseEnter={() => setIndex(hitIndex)}
                onClick={() => {
                  ui.select(null);
                  ui.setMenuOpen(false);
                  ui.setSearchOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">
                  {hit.kind === "tag" ? (
                    <TagMark name={hit.name} color={hit.color} />
                  ) : (
                    hit.label
                  )}
                </span>
                <OpenMark />
              </Link>
            ) : (
              <button
                key={`item-${hit.id}`}
                id={`search-hit-${hitIndex}`}
                type="button"
                role="option"
                aria-selected={hitIndex === active}
                className={cx(
                  "flex w-full items-center gap-2 px-2 py-2 text-left",
                  hoverRow,
                  hitIndex === active && "bg-accent-soft text-accent"
                )}
                onMouseEnter={() => setIndex(hitIndex)}
                onClick={() => openHit(hit)}
              >
                <PriorityMark priority={hit.priority} />
                <span className="min-w-0 flex-1 truncate">{hit.label}</span>
                <OpenMark />
              </button>
            )
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Šipky vyberou, Enter otevře, Escape zavře
        </p>
      </div>
    </div>
  );
}
