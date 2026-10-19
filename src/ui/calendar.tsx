import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dispatch, useSnap } from "../data/store.tsx";
import {
  addMonths,
  dueDateKey,
  dueTime,
  formatDay,
  isoWeekday,
  parseDateKey,
  todayKey,
} from "../domain/dates.ts";
import { byId, inboxFolder, resolvedOpen } from "../domain/db.ts";
import { planOnDay } from "../domain/horizon.ts";
import { keyBetween } from "../domain/ordering.ts";
import type { Op } from "../domain/op.ts";
import { opsFromTaskDraft, parseQuickAdd } from "../domain/quickAdd.ts";
import { folderTrail, isChecked, isOpenItem, suggestFolders } from "../domain/select.ts";
import type { Item, NewItem, Priority } from "../domain/types.ts";
import { registerDraftFolderUndo } from "./draftFolder.ts";
import { DictateButton } from "./dictate.tsx";
import { FolderGlyph } from "./folders.tsx";
import { useUi } from "./state.tsx";
import { placeCreated } from "./move.ts";
import { clickItem, FolderHint, itemMarked, toggleComplete } from "./tasks.tsx";
import {
  Button,
  cx,
  hoverRow,
  IconButton,
  OpenMark,
  PriorityMark,
} from "./ui.tsx";

const HEADS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export function monthCells(month: string): Array<string | null> {
  const first = `${month}-01`;
  const pad = isoWeekday(first) - 1;
  const origin = parseDateKey(first);
  const count = new Date(
    origin.getFullYear(),
    origin.getMonth() + 1,
    0
  ).getDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= count; day += 1)
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function itemsOnDay(items: Item[], day: string): Item[] {
  return items.filter(
    (item) =>
      dueDateKey(item.dueAt) === day ||
      planOnDay(item.plannedFor, item.planUntil, day)
  );
}

function priorityRank(priority: Priority | null): number {
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "low") return 3;
  return 2;
}

function dayKind(item: Item, day: string): "due" | "plan" {
  return dueDateKey(item.dueAt) === day ? "due" : "plan";
}

function automaticDayRank(
  left: Item,
  right: Item,
  day: string,
  open: (item: Item) => boolean
) {
  const openRank = Number(!open(left)) - Number(!open(right));
  if (openRank !== 0) return openRank;
  const dueRank =
    Number(dayKind(left, day) !== "due") - Number(dayKind(right, day) !== "due");
  if (dueRank !== 0) return dueRank;
  const leftTime =
    dayKind(left, day) === "due" ? dueTime(left.dueAt, left.dueHasTime) : null;
  const rightTime =
    dayKind(right, day) === "due"
      ? dueTime(right.dueAt, right.dueHasTime)
      : null;
  if (leftTime && !rightTime) return -1;
  if (!leftTime && rightTime) return 1;
  if (leftTime && rightTime && leftTime !== rightTime)
    return leftTime < rightTime ? -1 : 1;
  const rank = priorityRank(left.priority) - priorityRank(right.priority);
  if (rank !== 0) return rank;
  return left.title.localeCompare(right.title, "cs");
}

export function orderedDayItems(
  items: Item[],
  day: string,
  open: (item: Item) => boolean
): Item[] {
  const rows = itemsOnDay(items, day);
  const manual = rows.some((item) => item.dayOrder);
  return rows.sort((left, right) => {
    if (manual) {
      const leftKey = left.dayOrder ?? "";
      const rightKey = right.dayOrder ?? "";
      if (leftKey !== rightKey) {
        if (!leftKey) return 1;
        if (!rightKey) return -1;
        return leftKey < rightKey ? -1 : 1;
      }
    }
    return automaticDayRank(left, right, day, open);
  });
}

export function dayMoveIds(
  ids: string[],
  movingId: string,
  beforeId: string
): string[] | null {
  if (movingId === beforeId) return null;
  if (!ids.includes(movingId) || !ids.includes(beforeId)) return null;
  const next = ids.filter((id) => id !== movingId);
  const index = next.indexOf(beforeId);
  if (index < 0) return null;
  next.splice(index, 0, movingId);
  if (next.every((id, at) => id === ids[at])) return null;
  return next;
}

export function dayOrderOps(ids: string[]): Op[] {
  let previous: string | null = null;
  return ids.map((id) => {
    const dayOrder = keyBetween(previous, null);
    previous = dayOrder;
    return { type: "updateItem", id, patch: { dayOrder } };
  });
}

function taskCount(count: number): string {
  if (count === 1) return "1 úkol";
  if (count >= 2 && count <= 4) return `${count} úkoly`;
  return `${count} úkolů`;
}

function dayTitle(day: string): string {
  const text = parseDateKey(day).toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toLocaleUpperCase("cs") + text.slice(1);
}

export function placeCreatedOnDay(
  item: NewItem,
  day: string,
  hint: {
    dueDay: string | null;
    dueTime: string | null;
    planFrom: string | null;
  }
): NewItem {
  if (hint.planFrom || hint.dueDay) return item;
  if (hint.dueTime)
    return {
      ...item,
      dueAt: `${day}T${hint.dueTime}`,
      dueHasTime: true,
      plannedFor: null,
      planUntil: null,
    };
  return {
    ...item,
    plannedFor: day,
    planUntil: null,
    dueAt: null,
    dueHasTime: false,
  };
}

export function CalendarBoard({
  items,
  folderId = null,
}: {
  items: Item[];
  folderId?: string | null;
}) {
  const { db } = useSnap();
  const today = todayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const [composerFocus, setComposerFocus] = useState(0);
  const cells = monthCells(month);
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("cs-CZ", {
    month: "long",
    year: "numeric",
  });
  const open = (item: Item) => isOpenItem(db, item);
  const selected = orderedDayItems(items, picked, open);
  const overdue = items
    .filter((item) => {
      const due = dueDateKey(item.dueAt);
      return Boolean(due && due < today && open(item));
    })
    .sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? ""));
  const shiftMonth = (delta: number) => {
    const next = addMonths(`${month}-01`, delta).slice(0, 7);
    setMonth(next);
    setPicked((current) => (current.startsWith(next) ? current : `${next}-01`));
  };
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-1">
        <IconButton label="Předchozí měsíc" onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={18} />
        </IconButton>
        <h2 className="min-w-0 flex-1 text-center font-display text-2xl capitalize">
          {label}
        </h2>
        <Button
          tone={picked === today ? "ghost" : "soft"}
          onClick={() => {
            setMonth(today.slice(0, 7));
            setPicked(today);
          }}
        >
          Dnes
        </Button>
        <IconButton label="Další měsíc" onClick={() => shiftMonth(1)}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
      {overdue.length > 0 && <Overdue items={overdue} today={today} />}
      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-medium text-muted">
          {HEADS.map((head, index) => (
            <div key={head} className={cx("py-2", columnWash(index))}>
              {head}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, index) =>
            day ? (
              <DayCell
                key={day}
                day={day}
                index={index}
                total={cells.length}
                today={today}
                active={day === picked}
                items={orderedDayItems(items, day, open)}
                onPick={() => {
                  setPicked(day);
                  setComposerFocus((current) => current + 1);
                }}
              />
            ) : (
              <div
                key={`empty-${index}`}
                className={cx(
                  cellFrame(index, cells.length),
                  columnWash(index)
                )}
              />
            )
          )}
        </div>
      </div>
      <section className="rounded-xl border border-line bg-panel px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="font-display text-xl">{dayTitle(picked)}</h3>
          <span className="text-sm text-muted">
            {picked === today ? "dnes · " : ""}
            {selected.length === 0 ? "nic" : taskCount(selected.length)}
          </span>
        </div>
        <DayItems items={selected} day={picked} today={today} />
        <DayComposer
          day={picked}
          folderId={folderId}
          focusRequest={composerFocus}
        />
      </section>
    </div>
  );
}

function cellFrame(index: number, total: number) {
  return cx(
    "min-h-[4.25rem] border-b border-r border-line p-1.5 md:min-h-28",
    index % 7 === 6 && "border-r-0",
    index >= total - 7 && "border-b-0"
  );
}

function columnWash(index: number) {
  return index % 7 >= 5 ? "bg-black/[0.045] dark:bg-white/[0.04]" : undefined;
}

const CHIP_LIMIT = 3;

function chipTone(item: Item, kind: "due" | "plan", done: boolean) {
  if (done)
    return "bg-black/[0.04] text-muted line-through dark:bg-white/[0.06]";
  if (kind === "plan")
    return "border border-dashed border-line bg-black/[0.03] text-ink dark:bg-white/[0.05]";
  const edge =
    item.priority === "urgent"
      ? "border-l-danger"
      : item.priority === "high"
      ? "border-l-warn"
      : item.priority === "low"
      ? "border-l-muted"
      : "border-l-accent";
  return cx("border-l-2 bg-black/[0.04] text-ink dark:bg-white/[0.08]", edge);
}

function dotTone(item: Item, kind: "due" | "plan", done: boolean) {
  if (done || kind === "plan") return "bg-muted/60";
  if (item.priority === "urgent") return "bg-danger";
  if (item.priority === "high") return "bg-warn";
  return "bg-accent";
}

function DayCell({
  day,
  index,
  total,
  today,
  active,
  items,
  onPick,
}: {
  day: string;
  index: number;
  total: number;
  today: string;
  active: boolean;
  items: Item[];
  onPick: () => void;
}) {
  const { db } = useSnap();
  const drop = useDroppable({ id: `plan:${day}`, data: { kind: "plan", day } });
  const weekend = isoWeekday(day) >= 6;
  const shown = items.slice(0, CHIP_LIMIT);
  const extra = items.length - shown.length;
  return (
    <button
      ref={drop.setNodeRef}
      type="button"
      aria-pressed={active}
      aria-label={`${formatDay(day, today)}, ${
        items.length === 0 ? "nic" : taskCount(items.length)
      }`}
      onClick={onPick}
      className={cx(
        cellFrame(index, total),
        "flex h-full min-w-0 flex-col items-stretch justify-start overflow-hidden text-left",
        drop.isOver || active
          ? "bg-accent-soft"
          : weekend
          ? "bg-black/[0.045] hover:bg-black/[0.07] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
          : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      )}
    >
      <span className="flex w-full items-center justify-between gap-1">
        <span
          className={cx(
            "grid size-6 place-items-center rounded-full text-sm",
            day === today && "bg-accent font-medium text-accent-ink",
            day !== today && day < today && "text-muted",
            day !== today && weekend && "text-muted"
          )}
        >
          {Number(day.slice(-2))}
        </span>
        {items.length > 1 && (
          <span className="text-[11px] tabular-nums text-muted">
            {items.length}
          </span>
        )}
      </span>
      {items.length > 0 && (
        <>
          <span className="mt-1 flex flex-wrap gap-1 md:hidden">
            {shown.map((item) => (
              <span
                key={item.id}
                className={cx(
                  "size-1.5 rounded-full",
                  dotTone(item, dayKind(item, day), !isOpenItem(db, item))
                )}
              />
            ))}
            {extra > 0 && (
              <span className="text-[10px] leading-none text-muted">
                +{extra}
              </span>
            )}
          </span>
          <span className="mt-1 hidden min-w-0 gap-1 md:grid">
            {shown.map((item) => {
              const kind = dayKind(item, day);
              const time =
                kind === "due" ? dueTime(item.dueAt, item.dueHasTime) : null;
              return (
                <span
                  key={item.id}
                  className={cx(
                    "min-w-0 truncate rounded-sm px-1 py-px text-xs leading-5",
                    chipTone(item, kind, !isOpenItem(db, item))
                  )}
                >
                  {time && (
                    <span className="tabular-nums text-muted">{time} </span>
                  )}
                  {item.title}
                </span>
              );
            })}
            {extra > 0 && (
              <span className="px-1 text-[10px] leading-4 text-muted">
                +{extra}
              </span>
            )}
          </span>
        </>
      )}
    </button>
  );
}

function Overdue({ items, today }: { items: Item[]; today: string }) {
  const ui = useUi();
  const shown = items.slice(0, 6);
  const extra = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2">
      <span className="pr-1 text-sm font-medium text-danger">Po termínu</span>
      {shown.map((item) => (
        <button
          key={item.id}
          type="button"
          className="max-w-52 truncate rounded-sm bg-raised px-2 py-0.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
          onClick={(event) => clickItem(ui, item.id, event)}
        >
          {formatDay(dueDateKey(item.dueAt) ?? today, today)} · {item.title}
        </button>
      ))}
      {extra > 0 && <span className="text-sm text-danger">+{extra}</span>}
    </div>
  );
}

function DayComposer({
  day,
  folderId,
  focusRequest,
}: {
  day: string;
  folderId: string | null;
  focusRequest: number;
}) {
  const { db } = useSnap();
  const ui = useUi();
  const ref = useRef<HTMLTextAreaElement>(null);
  const skip = useRef(false);
  const [draft, setDraft] = useState("");
  const [folderOverride, setFolderOverride] = useState<string | null>(null);
  const parsed = parseQuickAdd(draft, db, todayKey());
  const baseFolder =
    (folderId ? byId(db.folders, folderId) : null) ?? inboxFolder(db);
  const suggestions = suggestFolders(db, parsed.title).filter(
    (folder) => folder.id !== (parsed.folderId ?? baseFolder?.id ?? null)
  );
  useEffect(() => {
    return registerDraftFolderUndo(
      () => folderOverride !== null,
      () => setFolderOverride(null)
    );
  }, [folderOverride]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, [draft]);
  const focused = useRef(focusRequest);
  useLayoutEffect(() => {
    if (focused.current === focusRequest) return;
    focused.current = focusRequest;
    ref.current?.focus();
  }, [focusRequest]);
  const commit = () => {
    const folder =
      byId(db.folders, folderOverride ?? baseFolder?.id ?? null) ?? baseFolder;
    if (!folder || !baseFolder) return;
    const filing = folderOverride !== null && folder.id !== baseFolder.id;
    const home = filing ? baseFolder : folder;
    const { ops, itemIds } = opsFromTaskDraft(db, draft, {
      folderId: home.id,
      statusId: resolvedOpen(db, home)?.id ?? null,
      dateRole: "due",
      applyRules: !filing && folder.system === "inbox",
      ids: () => nanoid(10),
      today: todayKey(),
    });
    if (itemIds.length === 0) return;
    const created = dispatch({
      type: "batch",
      ops: ops.map((op) =>
        op.type === "createItem"
          ? { ...op, item: placeCreatedOnDay(op.item, day, parsed) }
          : op
      ),
    });
    const fileOps = filing ? placeCreated(created, itemIds, folder.id) : [];
    const next =
      fileOps.length > 0 ? dispatch({ type: "batch", ops: fileOps }) : created;
    setDraft("");
    setFolderOverride(null);
    if (fileOps.length > 0) {
      ui.pushToast(`Zařazeno do ${folder.name}`, true);
      return;
    }
    const inbox = inboxFolder(db);
    if (!inbox || filing || baseFolder.system !== "inbox") return;
    const moved = itemIds.flatMap((id) => {
      const item = byId(next.items, id);
      return item && item.folderId !== inbox.id ? [item] : [];
    });
    if (moved.length !== 1) return;
    const ruleHome = byId(next.folders, moved[0]?.folderId ?? null);
    ui.pushToast(ruleHome ? `Zařazeno do ${ruleHome.name}` : "Zařazeno", true);
  };
  return (
    <div className="mt-1">
    <div className="flex items-start gap-1 pr-1">
      <span className="grid size-9 shrink-0 place-items-center text-muted">
        <Plus size={16} />
      </span>
      <textarea
        ref={ref}
        rows={1}
        aria-label="Nový úkol"
        placeholder="Nový úkol…"
        className="block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent py-2 outline-none placeholder:text-muted"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            skip.current = true;
            setDraft("");
            setFolderOverride(null);
            event.currentTarget.blur();
            return;
          }
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.nativeEvent.isComposing
          )
            return;
          event.preventDefault();
          commit();
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Element &&
            event.relatedTarget.closest(
              "[data-dictate], [data-folder-suggest], [data-history-undo]"
            )
          )
            return;
          if (skip.current) {
            skip.current = false;
            return;
          }
          commit();
        }}
      />
      <DictateButton value={draft} onChange={setDraft} />
    </div>
    {suggestions.length > 0 && (
      <div className="mt-1 flex flex-wrap gap-1 pl-10">
        {suggestions.map((folder) => {
          const selected = folderOverride === folder.id;
          return (
            <Button
              key={folder.id}
              tone={selected ? "solid" : "ghost"}
              aria-pressed={selected}
              data-folder-suggest=""
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                setFolderOverride((current) =>
                  current === folder.id ? null : folder.id
                )
              }
            >
              {selected && <Check size={14} />}
              {folderTrail(db, folder.id)
                .map((part) => part.name)
                .join(" / ")}
            </Button>
          );
        })}
      </div>
    )}
    </div>
  );
}

function DayItems({
  items,
  day,
  today,
}: {
  items: Item[];
  day: string;
  today: string;
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted">Na tenhle den nic není.</p>;
  const showTime = items.some(
    (item) =>
      dayKind(item, day) === "due" && dueTime(item.dueAt, item.dueHasTime)
  );
  return (
    <SortableContext
      items={items.map((item) => `item:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div className="grid gap-0.5" data-calendar-list="">
        {items.map((item) => (
          <DayItem key={item.id} item={item} day={day} today={today} showTime={showTime} />
        ))}
      </div>
    </SortableContext>
  );
}

function useDragGuard(isDragging: boolean) {
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) {
      dragged.current = true;
      return;
    }
    if (!dragged.current) return;
    const timer = window.setTimeout(() => {
      dragged.current = false;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isDragging]);
  return () => {
    if (!dragged.current) return false;
    dragged.current = false;
    return true;
  };
}

function DayItem({
  item,
  day,
  today,
  showTime,
}: {
  item: Item;
  day: string;
  today: string;
  showTime: boolean;
}) {
  const { db } = useSnap();
  const ui = useUi();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `item:${item.id}`,
      data: { kind: "item", itemId: item.id, calendarDay: day },
    });
  const dragClick = useDragGuard(isDragging);
  const kind = dayKind(item, day);
  const time = kind === "due" ? dueTime(item.dueAt, item.dueHasTime) : null;
  const checked = isChecked(db, item);
  const late = kind === "due" && day < today && isOpenItem(db, item);
  const folder = byId(db.folders, item.folderId);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-task-id={item.id}
      className={cx(
        "flex w-full cursor-grab items-start gap-1 rounded-md pr-1 active:cursor-grabbing",
        hoverRow,
        itemMarked(ui.picked, ui.selectedId, item.id) && "bg-accent/25",
        isDragging && "opacity-40"
      )}
      {...attributes}
      {...listeners}
      tabIndex={-1}
      role={undefined}
      onMouseDown={(event) => {
        listeners?.onMouseDown?.(event);
        if (event.shiftKey) event.preventDefault();
      }}
    >
      <label
        className="grid size-9 shrink-0 place-items-center"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="size-5"
          type="checkbox"
          checked={checked}
          aria-label={checked ? "Označit jako otevřené" : "Označit jako hotové"}
          onChange={() => toggleComplete(db, item, ui.askConfirm)}
        />
      </label>
      <div className="min-w-0 flex-1 py-2">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault();
          }}
          onClick={(event) => {
            if (dragClick()) return;
            clickItem(ui, item.id, event);
          }}
        >
          {showTime && (
            <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-muted">
              {time}
            </span>
          )}
          <span
            className={cx(
              "min-w-0 flex-1 truncate",
              checked ? "text-muted line-through" : "font-medium"
            )}
          >
            {item.title}
          </span>
          <OpenMark />
        </button>
        <span
          className={cx(
            "mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted",
            showTime && "pl-15"
          )}
        >
          {folder && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <FolderGlyph color={folder.color} className="h-3.5" />
              <span className="truncate">{folder.name}</span>
            </span>
          )}
          {isOpenItem(db, item) && <FolderHint item={item} />}
          {late && <span className="font-medium text-danger">po termínu</span>}
          {item.priority && <PriorityMark priority={item.priority} />}
        </span>
      </div>
    </div>
  );
}

export function PlanTargets() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <PlanChip id="plan:today" label="Sem přetáhni úkol na dnešek" />
      <PlanChip id="plan:tomorrow" label="Sem přetáhni úkol na zítřek" />
    </div>
  );
}

function PlanChip({ id, label }: { id: string; label: string }) {
  const drop = useDroppable({ id });
  return (
    <div
      ref={drop.setNodeRef}
      className={cx(
        "cursor-default rounded-md border border-dashed border-line px-3 py-3 text-sm text-muted",
        drop.isOver && "border-accent bg-accent-soft text-accent"
      )}
    >
      {label}
    </div>
  );
}
