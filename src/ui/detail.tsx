import { Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { dispatch, useSnap } from "../data/store.tsx";
import { combineDue, dueChoices, formatDay, todayKey } from "../domain/dates.ts";
import { horizonPresets, planLabel } from "../domain/horizon.ts";
import { parseQuickAdd } from "../domain/quickAdd.ts";
import { pullHashtags, removeToken } from "../domain/hashtags.ts";
import { continueMarkdownList } from "../domain/markdownEdit.ts";
import { alive, byId, resolvedOpen, statusesOf } from "../domain/db.ts";
import { newItem } from "../domain/factory.ts";
import { priorityLabel } from "../domain/labels.ts";
import { recurrenceLabel, weekdaysFrom, weekdaysTo } from "../domain/recurrence.ts";
import {
  blockedItems,
  blockingItems,
  linksOf,
  mapStatus,
  otherId,
  searchItems,
  subtasksOf,
  tagsOf,
} from "../domain/select.ts";
import type { Item, RecurrenceFreq } from "../domain/types.ts";
import { FolderCrumbs } from "./folders.tsx";
import { FolderPicker } from "./folderPick.tsx";
import { downloadIcs, googleCalendarUrl } from "../lib/ics.ts";
import { placeOp } from "./move.ts";
import { useUi } from "./state.tsx";
import { askDeleteItems } from "./tasks.tsx";
import { dispatchTaskText, TagMenu, useTagHint } from "./tagHint.tsx";
import { MarkdownLink } from "./links.tsx";
import { Button, control, cx, hoverRow, IconButton, OpenMark, priorityChip, PriorityMark } from "./ui.tsx";

const WEEK = [
  [1, "Po"],
  [2, "Út"],
  [3, "St"],
  [4, "Čt"],
  [5, "Pá"],
  [6, "So"],
  [7, "Ne"],
] as const;

function Fact({
  children,
  onClick,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "warn" | "danger";
}) {
  return (
    <button
      type="button"
      className="rounded-sm px-1 py-0.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
      onClick={onClick}
    >
      <span
        className={
          tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : undefined
        }
      >
        {children}
      </span>
    </button>
  );
}

function PlanEditor({ item }: { item: Item }) {
  const { db } = useSnap();
  const today = todayKey();
  const [phrase, setPhrase] = useState("");
  const ranged = Boolean(
    item.plannedFor && item.planUntil && item.planUntil > item.plannedFor
  );
  const apply = (from: string | null, until: string | null) => {
    dispatch({
      type: "updateItem",
      id: item.id,
      patch: {
        plannedFor: from,
        planUntil: from && until && until > from ? until : null,
      },
    });
  };
  const commitPhrase = () => {
    const text = phrase.trim();
    if (!text) return;
    const parsed = parseQuickAdd(text, db, today);
    if (parsed.planFrom) apply(parsed.planFrom, parsed.planUntil);
    else if (parsed.dueDay) apply(parsed.dueDay, null);
    else return;
    setPhrase("");
  };
  return (
    <div className="grid gap-2">
      {item.plannedFor && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">{planLabel(item.plannedFor, item.planUntil, today)}</p>
          <button
            type="button"
            className="text-xs text-muted hover:text-ink"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(null, null)}
          >
            Zrušit
          </button>
        </div>
      )}
      <input
        className={control}
        aria-label="Období"
        placeholder="třeba do 3 měsíců"
        value={phrase}
        onChange={(event) => setPhrase(event.target.value)}
        onBlur={commitPhrase}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitPhrase();
        }}
      />
      <div className="flex flex-wrap gap-1">
        {horizonPresets(today).map((preset) => {
          const selected =
            item.plannedFor === preset.from && item.planUntil === preset.until;
          return (
            <button
              key={preset.id}
              type="button"
              className={cx(
                "rounded-sm px-2 py-1 text-xs",
                selected
                  ? "bg-accent-soft text-accent"
                  : "bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(preset.from, preset.until)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <input
        className={control}
        type="date"
        aria-label="Naplánovat na"
        value={ranged ? "" : item.plannedFor ?? ""}
        onChange={(event) => apply(event.target.value || null, null)}
      />
    </div>
  );
}

function DueFields({ item }: { item: Item }) {
  const today = todayKey();
  const choices = dueChoices(today);
  const day = item.dueAt?.slice(0, 10) ?? "";
  const time = item.dueHasTime ? item.dueAt?.slice(11, 16) ?? "" : "";
  const apply = (nextDay: string | null, nextTime: string | null) =>
    dispatch({
      type: "updateItem",
      id: item.id,
      patch: combineDue(nextDay, nextTime),
    });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {choices.map((choice) => {
          const selected = choice.day === day && (choice.time ?? "") === time;
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={selected}
              className={cx(
                "rounded-sm px-2 py-1 text-xs",
                selected
                  ? "bg-accent-soft text-accent"
                  : "bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(selected ? null : choice.day, selected ? null : choice.time)}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          className={control}
          type="date"
          aria-label="Termín"
          value={day}
          onChange={(event) =>
            apply(event.target.value || null, event.target.value ? time || null : null)
          }
        />
        <input
          className={control}
          type="time"
          aria-label="Čas"
          value={time}
          onChange={(event) => {
            const next = event.target.value;
            apply(next ? day || today : day || null, next || null);
          }}
        />
      </div>
    </div>
  );
}

function PriorityFields({ item }: { item: Item }) {
  return (
    <div className="flex flex-wrap gap-1">
      {([null, "low", "high", "urgent"] as const).map((priority) => {
        const selected = item.priority === priority;
        const tone = priorityChip(priority, selected);
        return (
          <button
            key={priority ?? "normal"}
            type="button"
            aria-pressed={selected}
            className={cx("rounded-sm px-2 py-1 text-xs font-medium", tone.box)}
            onClick={() =>
              dispatch({
                type: "updateItem",
                id: item.id,
                patch: { priority },
              })
            }
          >
            <span className={tone.ink}>{priorityLabel(priority)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ShopFields({ item }: { item: Item }) {
  const set = (patch: {
    store?: string | null;
    quantity?: string | null;
    unit?: string | null;
    spec?: string | null;
  }) => dispatch({ type: "updateItem", id: item.id, patch });
  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        className={control}
        aria-label="Obchod"
        placeholder="Obchod"
        value={item.store ?? ""}
        onChange={(event) => set({ store: event.target.value || null })}
      />
      <input
        className={control}
        aria-label="Množství"
        placeholder="Množství"
        value={item.quantity ?? ""}
        onChange={(event) => set({ quantity: event.target.value || null })}
      />
      <input
        className={control}
        aria-label="Jednotka"
        placeholder="Jednotka"
        value={item.unit ?? ""}
        onChange={(event) => set({ unit: event.target.value || null })}
      />
      <input
        className={control}
        aria-label="Specifikace"
        placeholder="Specifikace"
        value={item.spec ?? ""}
        onChange={(event) => set({ spec: event.target.value || null })}
      />
      <button
        type="button"
        className="col-span-2 w-fit text-xs text-muted hover:text-ink"
        onClick={() =>
          dispatch({ type: "makeTemplate", id: nanoid(10), itemId: item.id })
        }
      >
        Kupovat opakovaně
      </button>
    </div>
  );
}

export function Detail({ item }: { item: Item }) {
  const { db } = useSnap();
  const ui = useUi();
  const folder = byId(db.folders, item.folderId);
  const tags = tagsOf(db, item.id);
  const [extra, setExtra] = useState<string | null>(null);
  useEffect(() => {
    setExtra(null);
  }, [item.id]);
  const people = alive(db.people);
  const allTags = alive(db.tags);
  const today = todayKey();
  const day = item.dueAt?.slice(0, 10) ?? "";
  const time = item.dueHasTime ? item.dueAt?.slice(11, 16) ?? "" : "";
  const dueLabel = item.dueAt
    ? `${formatDay(day, today)}${time ? ` ${time}` : ""}`
    : null;
  const planText = item.plannedFor
    ? planLabel(item.plannedFor, item.planUntil, today)
    : null;
  const repeat = recurrenceLabel(item);
  const person = byId(db.people, item.assigneeId);
  const shop = [
    item.quantity
      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
      : null,
    item.store,
    item.spec,
  ]
    .filter(Boolean)
    .join(" · ");
  const toggle = (key: string) =>
    setExtra((current) => (current === key ? null : key));

  const setFolder = (folderId: string) => {
    const mapped = mapStatus(db, item.statusId, folderId);
    const go = (statusId: string) =>
      dispatch(placeOp(db, item.id, folderId, statusId));
    if (mapped.choices.length > 1) {
      ui.askChoice({
        title: "Který stav?",
        options: mapped.choices.map((status) => ({
          id: status.id,
          label: status.name,
        })),
        onPick: go,
      });
      return;
    }
    if (mapped.statusId) go(mapped.statusId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <FolderCrumbs folderId={item.folderId} scope="detail" />
        <IconButton label="Zavřít" onClick={() => ui.select(null)}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="grid content-start gap-3 overflow-y-auto px-3 py-3">
        <DetailTitle item={item} />
        {(item.body || extra === "body") && (
          <BodyEditor
            item={item}
            onCollapse={() => setExtra(null)}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {folder && item.type === "task" && (
            <select
              className="max-w-full bg-transparent py-0.5 text-sm outline-none"
              aria-label="Stav"
              value={item.statusId ?? ""}
              onChange={(event) =>
                dispatch(placeOp(db, item.id, folder.id, event.target.value))
              }
            >
              {statusesOf(db, folder.id).map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          )}
          {dueLabel && <Fact onClick={() => toggle("due")}>{dueLabel}</Fact>}
          {planText && (
            <Fact onClick={() => toggle("plan")}>plán {planText}</Fact>
          )}
          {repeat && <Fact onClick={() => toggle("repeat")}>{repeat}</Fact>}
          {item.priority && (
            <button
              type="button"
              className="rounded-sm"
              onClick={() => toggle("priority")}
            >
              <PriorityMark priority={item.priority} />
            </button>
          )}
          {person && (
            <Fact onClick={() => toggle("person")}>{person.name}</Fact>
          )}
          {shop && <Fact onClick={() => toggle("shop")}>{shop}</Fact>}
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              title="Odebrat štítek"
              className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-xs text-accent"
              onClick={() =>
                dispatch({
                  type: "setItemTags",
                  itemId: item.id,
                  tagIds: tags
                    .filter((entry) => entry.id !== tag.id)
                    .map((entry) => entry.id),
                })
              }
            >
              #{tag.name} ×
              <span className="sr-only"> odebrat</span>
            </button>
          ))}
        </div>
        <Relations item={item} />
        <Subtasks item={item} />
        {extra === "due" && <DueFields item={item} />}
        {extra === "plan" && <PlanEditor item={item} />}
        {extra === "repeat" && <RecurrenceEditor item={item} />}
        {extra === "priority" && <PriorityFields item={item} />}
        {extra === "person" && (
          <select
            className={control}
            aria-label="Člověk"
            value={item.assigneeId ?? ""}
            onChange={(event) =>
              dispatch({
                type: "updateItem",
                id: item.id,
                patch: { assigneeId: event.target.value || null },
              })
            }
          >
            <option value="">Nikdo</option>
            {people.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
        {extra === "tag" && (
          <TagAdder item={item} names={allTags.map((tag) => tag.name)} />
        )}
        {extra === "shop" && <ShopFields item={item} />}
        {extra === "wait" && (
          <RelationComposer item={item} mode="wait" onDone={() => setExtra(null)} />
        )}
        {extra === "link" && (
          <RelationComposer item={item} mode="link" onDone={() => setExtra(null)} />
        )}
        {extra === "sub" && <SubtaskComposer item={item} onDone={() => setExtra(null)} />}
        {extra === "move" && (
          <FolderPicker
            value={item.folderId}
            onPick={(folderId) => {
              if (folderId) setFolder(folderId);
            }}
          />
        )}
        {extra === "more" && (
          <div className="flex flex-wrap gap-1 text-muted">
            {(item.type === "task"
              ? [
                  ["due", "Termín"],
                  ["plan", "Plán"],
                  ["repeat", "Opakování"],
                  ["priority", "Priorita"],
                  ["person", "Člověk"],
                  ["shop", "Nákup"],
                  ["wait", "Čeká na"],
                  ["sub", "Podúkol"],
                ]
              : []
            ).concat([
              ["tag", "Štítek"],
              ["link", "Odkaz"],
              ["body", "Popis"],
              ["move", "Složka"],
            ]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="rounded-sm px-2 py-1 text-xs hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
                onClick={() => setExtra(key)}
              >
                {label}
              </button>
            ))}
            {(item.dueAt || item.plannedFor) && (
              <>
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 text-xs hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
                  onClick={() => downloadIcs(item)}
                >
                  .ics
                </button>
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 text-xs hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
                  onClick={() => {
                    const url = googleCalendarUrl(item);
                    if (url) window.open(url, "_blank", "noopener");
                  }}
                >
                  Google
                </button>
              </>
            )}
            <button
              type="button"
              className="rounded-sm px-2 py-1 text-xs hover:bg-danger/10"
              onClick={() =>
                askDeleteItems([item], ui.askConfirm, () => ui.setSelected(null))
              }
            >
              <span className="text-danger">Smazat</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className="w-fit text-xs"
          onClick={() => toggle("more")}
        >
          <span className="text-muted">více</span>
        </button>
      </div>
    </div>
  );
}

function DetailTitle({ item }: { item: Item }) {
  const { db } = useSnap();
  const field = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const started = useRef(item.title);
  const seen = useRef(item.id);
  if (seen.current !== item.id) {
    seen.current = item.id;
    started.current = item.title;
  }
  const [caret, setCaret] = useState(0);
  const hint = useTagHint(item.type === "task" ? item.title : "", caret);
  useLayoutEffect(() => {
    const node = field.current;
    const next = pendingCaret.current;
    if (!node || next === null) return;
    pendingCaret.current = null;
    node.setSelectionRange(next, next);
  }, [item.title]);
  const pickTag = (name: string) => {
    if (!hint.token) return;
    const cleaned = removeToken(item.title, hint.token.start, hint.token.end);
    const title = cleaned.trim();
    const shown = title || item.title;
    pendingCaret.current = Math.min(hint.token.start, shown.length);
    setCaret(pendingCaret.current);
    dispatchTaskText(db, item, title && title !== item.title ? { title } : {}, [name]);
    field.current?.focus();
  };
  return (
    <div className="min-w-0 font-display text-2xl leading-tight">
      <input
        ref={field}
        data-detail-title
        className="w-full min-w-0 bg-transparent outline-none"
        value={item.title}
        onChange={(event) => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          dispatch({
            type: "updateItem",
            id: item.id,
            patch: { title: event.target.value },
          });
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onFocus={(event) => {
          started.current = event.currentTarget.value;
        }}
        onKeyDown={(event) => {
          const key = hint.onKey(event);
          if (!key.handled) return;
          if (key.name) pickTag(key.name);
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Element && next.closest("[role=listbox]")) return;
          if (item.type === "task") {
            const pulled = pullHashtags(event.currentTarget.value);
            const title = pulled.text.trim() || started.current.trim();
            dispatchTaskText(
              db,
              item,
              title && title !== item.title ? { title } : {},
              pulled.names
            );
          }
          dispatch({
            type: "updateItem",
            id: item.id,
            patch: {},
            fileInbox: true,
          });
        }}
      />
      {hint.open && (
        <TagMenu
          anchor={field.current}
          tags={hint.tags}
          picked={hint.picked}
          onHover={hint.setHighlight}
          onPick={pickTag}
        />
      )}
    </div>
  );
}

function BodyEditor({
  item,
  onCollapse,
}: {
  item: Item;
  onCollapse: () => void;
}) {
  const { db } = useSnap();
  const field = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<number | null>(null);
  const [mode, setMode] = useState<"write" | "read">(
    item.body ? "read" : "write"
  );
  const [selection, setSelection] = useState("");
  const [caret, setCaret] = useState(0);
  const hint = useTagHint(
    item.type === "task" && mode === "write" ? (item.body ?? "") : "",
    caret
  );
  useLayoutEffect(() => {
    const node = field.current;
    if (!node || cursor.current == null) return;
    node.selectionStart = node.selectionEnd = cursor.current;
    cursor.current = null;
  }, [item.body]);
  const parts = useMemo(() => splitTasks(item.body ?? ""), [item.body]);
  const createTask = () => {
    const title = selection.trim();
    if (!title) return;
    const id = nanoid(10);
    const folder = byId(db.folders, item.folderId);
    const statusId = folder ? resolvedOpen(db, folder)?.id ?? null : null;
    dispatch({
      type: "batch",
      ops: [
        {
          type: "createItem",
          item: newItem({ id, folderId: item.folderId, title, statusId }),
        },
        {
          type: "addLink",
          id: nanoid(10),
          fromId: item.id,
          toId: id,
          kind: "taskFromNote",
        },
        {
          type: "updateItem",
          id: item.id,
          patch: { body: `${item.body ?? ""}\n{{task:${id}}}` },
        },
      ],
    });
    setSelection("");
  };
  const pickTag = (name: string) => {
    if (!hint.token) return;
    const cleaned = removeToken(item.body ?? "", hint.token.start, hint.token.end);
    const body = cleaned.trim() ? cleaned.replace(/\s+$/, "") : null;
    cursor.current = Math.min(hint.token.start, cleaned.length);
    setCaret(cursor.current);
    dispatchTaskText(db, item, (item.body ?? null) === body ? {} : { body }, [name]);
    field.current?.focus();
  };
  return (
    <div className="grid gap-2">
      {selection && (
        <Button
          tone="soft"
          onMouseDown={(event) => event.preventDefault()}
          onClick={createTask}
        >
          Úkol z výběru
        </Button>
      )}
      {mode === "write" ? (
        <>
        <textarea
          ref={field}
          autoFocus
          className={`${control} min-h-20`}
          value={item.body ?? ""}
          onKeyDown={(event) => {
            const key = hint.onKey(event);
            if (key.handled) {
              if (key.name) pickTag(key.name);
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
            const next = continueMarkdownList(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd
            );
            if (!next) return;
            event.preventDefault();
            cursor.current = next.cursor;
            setCaret(next.cursor);
            dispatch({
              type: "updateItem",
              id: item.id,
              patch: { body: next.value || null },
            });
          }}
          onChange={(event) => {
            setCaret(event.target.selectionStart ?? event.target.value.length);
            dispatch({
              type: "updateItem",
              id: item.id,
              patch: { body: event.target.value || null },
            });
          }}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Element && next.closest("[role=listbox]")) return;
            const raw = event.currentTarget.value;
            const pulled = item.type === "task" ? pullHashtags(raw) : { text: raw, names: [] };
            if (pulled.names.length > 0) {
              const body = pulled.text || null;
              dispatchTaskText(
                db,
                item,
                (item.body ?? null) === body ? {} : { body },
                pulled.names
              );
            }
            dispatch({
              type: "updateItem",
              id: item.id,
              patch: {},
              fileInbox: true,
            });
            if (!pulled.text.trim()) onCollapse();
            else setMode("read");
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0);
            setSelection(
              event.currentTarget.value.slice(
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd
              )
            );
          }}
        />
        {hint.open && (
          <TagMenu
            anchor={field.current}
            tags={hint.tags}
            picked={hint.picked}
            onHover={hint.setHighlight}
            onPick={pickTag}
          />
        )}
      </>
      ) : (
        <div
          className="prose-sm grid gap-1 text-sm"
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("a,button")) return;
            setMode("write");
          }}
        >
          {parts.map((part, index) =>
            part.kind === "task" ? (
              <TaskEmbed key={part.id} id={part.id} />
            ) : (
              <Markdown
                key={index}
                remarkPlugins={[remarkGfm]}
                components={{ a: MarkdownLink }}
              >
                {part.text}
              </Markdown>
            )
          )}
        </div>
      )}
    </div>
  );
}

function splitTasks(
  body: string
): Array<{ kind: "text"; text: string } | { kind: "task"; id: string }> {
  const parts: Array<
    { kind: "text"; text: string } | { kind: "task"; id: string }
  > = [];
  const pattern = /\{\{task:([A-Za-z0-9_-]+)\}\}/g;
  let cursor = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > cursor)
      parts.push({ kind: "text", text: body.slice(cursor, match.index) });
    parts.push({ kind: "task", id: match[1] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length)
    parts.push({ kind: "text", text: body.slice(cursor) });
  return parts.filter((part) => part.kind === "task" || part.text.trim());
}

function TaskEmbed({ id }: { id: string }) {
  const { db } = useSnap();
  const ui = useUi();
  const item = byId(db.items, id);
  if (!item || item.isDeleted)
    return <p className="text-muted">Úkol už tu není.</p>;
  const folder = byId(db.folders, item.folderId);
  const done = folder
    ? item.statusId ===
      (folder
        ? statusesOf(db, folder.id).find((status) => status.meaning === "done")
            ?.id
        : null)
    : false;
  return (
    <button
      type="button"
      className={cx("flex items-center gap-2 border border-line px-2 py-1.5 text-left", hoverRow)}
      onClick={() => ui.select(item.id)}
    >
      <span className={cx("min-w-0 flex-1 truncate", done && "text-muted line-through")}>
        {item.title}
      </span>
      <OpenMark />
    </button>
  );
}

function TagAdder({ item, names }: { item: Item; names: string[] }) {
  const { db } = useSnap();
  const [value, setValue] = useState("");
  const add = () => {
    const name = value.trim();
    if (!name) return;
    const existing = alive(db.tags).find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase()
    );
    const id = existing?.id ?? nanoid(10);
    const current = tagsOf(db, item.id).map((tag) => tag.id);
    dispatch({
      type: "batch",
      ops: [
        ...(existing
          ? []
          : [{ type: "ensureTag" as const, id, name, color: null }]),
        {
          type: "setItemTags" as const,
          itemId: item.id,
          tagIds: [...current, id],
        },
      ],
    });
    setValue("");
  };
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        className={control}
        list="tags"
        placeholder="Štítek"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <datalist id="tags">
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <Button tone="soft" type="submit">
        Přidat
      </Button>
    </form>
  );
}

function RecurrenceEditor({ item }: { item: Item }) {
  const days = weekdaysFrom(item.recurrenceWeekdays);
  const set = (freq: RecurrenceFreq | null, weekdays = days) => {
    dispatch({
      type: "setRecurrence",
      itemId: item.id,
      freq,
      interval: item.recurrenceInterval ?? 1,
      weekdays: weekdaysTo(weekdays),
      until: item.recurrenceUntil,
    });
  };
  return (
    <div className="grid gap-2">
      <select
        className={control}
        aria-label="Opakování"
        value={item.recurrenceFreq ?? ""}
        onChange={(event) =>
          set((event.target.value || null) as RecurrenceFreq | null)
        }
      >
        <option value="">Neopakovat</option>
        <option value="daily">Každý den</option>
        <option value="weekly">Vybrané dny</option>
        <option value="monthly">Každý měsíc</option>
        <option value="interval">Každých N dní</option>
      </select>
      {item.recurrenceFreq === "interval" && (
        <input
          className={control}
          aria-label="Počet dní"
          type="number"
          min={1}
          value={item.recurrenceInterval ?? 1}
          onChange={(event) =>
            dispatch({
              type: "setRecurrence",
              itemId: item.id,
              freq: "interval",
              interval: Number(event.target.value) || 1,
              weekdays: item.recurrenceWeekdays,
              until: item.recurrenceUntil,
            })
          }
        />
      )}
      {item.recurrenceFreq === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {WEEK.map(([day, label]) => {
            const on = days.includes(day);
            return (
              <Button
                key={day}
                tone={on ? "soft" : "ghost"}
                onClick={() =>
                  set(
                    "weekly",
                    on ? days.filter((value) => value !== day) : [...days, day]
                  )
                }
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}
      <input
        className={control}
        type="date"
        aria-label="Opakovat do"
        value={item.recurrenceUntil ?? ""}
        onChange={(event) =>
          dispatch({
            type: "setRecurrence",
            itemId: item.id,
            freq: item.recurrenceFreq,
            interval: item.recurrenceInterval,
            weekdays: item.recurrenceWeekdays,
            until: event.target.value || null,
          })
        }
      />
    </div>
  );
}

function Subtasks({ item }: { item: Item }) {
  const { db } = useSnap();
  const ui = useUi();
  const children = subtasksOf(db, item.id);
  if (children.length === 0) return null;
  return (
    <div>
      {children.map((child) => (
        <button
          key={child.id}
          type="button"
          className={cx(
            "flex w-full items-center gap-2 px-1 py-1 text-left text-sm",
            hoverRow
          )}
          onClick={() => ui.select(child.id)}
        >
          <span className="min-w-0 flex-1 truncate">{child.title}</span>
          <OpenMark />
        </button>
      ))}
    </div>
  );
}

function SubtaskComposer({
  item,
  onDone,
}: {
  item: Item;
  onDone: () => void;
}) {
  const { db } = useSnap();
  const [title, setTitle] = useState("");
  const add = () => {
    const text = title.trim();
    if (!text) return;
    const folder = byId(db.folders, item.folderId);
    dispatch({
      type: "createItem",
      item: newItem({
        id: nanoid(10),
        folderId: item.folderId,
        title: text,
        parentItemId: item.id,
        statusId: folder ? (resolvedOpen(db, folder)?.id ?? null) : null,
      }),
    });
    setTitle("");
    onDone();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        className={control}
        autoFocus
        placeholder="Nový podúkol"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
  );
}

function Relations({ item }: { item: Item }) {
  const { db } = useSnap();
  const ui = useUi();
  const waiting = blockingItems(db, item.id);
  const blocking = blockedItems(db, item.id);
  const links = linksOf(db, item.id);
  if (waiting.length + blocking.length + links.length === 0) return null;
  return (
    <div>
      {waiting.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={cx(
            "flex w-full items-center gap-2 px-1 py-1 text-left text-sm",
            hoverRow
          )}
          onClick={() => ui.select(entry.id)}
        >
          <span className="min-w-0 flex-1 truncate">Čeká na {entry.title}</span>
          <OpenMark />
        </button>
      ))}
      {blocking.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={cx(
            "flex w-full items-center gap-2 px-1 py-1 text-left text-sm",
            hoverRow
          )}
          onClick={() => ui.select(entry.id)}
        >
          <span className="min-w-0 flex-1 truncate">Blokuje {entry.title}</span>
          <OpenMark />
        </button>
      ))}
      {links.map((link) => {
        const other = byId(db.items, otherId(link, item.id));
        if (!other) return null;
        return (
          <button
            key={link.id}
            type="button"
            className={cx(
              "flex w-full items-center gap-2 px-1 py-1 text-left text-sm text-accent",
              hoverRow
            )}
            onClick={() => ui.select(other.id)}
          >
            <span className="min-w-0 flex-1 truncate">{other.title}</span>
            <OpenMark />
          </button>
        );
      })}
    </div>
  );
}

function RelationComposer({
  item,
  mode,
  onDone,
}: {
  item: Item;
  mode: "wait" | "link";
  onDone: () => void;
}) {
  const { db } = useSnap();
  const [query, setQuery] = useState("");
  const results = query.trim()
    ? searchItems(db, query)
        .filter((entry) => entry.id !== item.id)
        .slice(0, 6)
    : [];
  const pick = (id: string) => {
    if (mode === "wait")
      dispatch({
        type: "addDependency",
        id: nanoid(10),
        itemId: item.id,
        dependsOnId: id,
      });
    else
      dispatch({
        type: "addLink",
        id: nanoid(10),
        fromId: item.id,
        toId: id,
        kind: "related",
      });
    onDone();
  };
  const createWaiting = () => {
    const text = query.trim();
    if (!text || mode !== "wait") return;
    const folder = byId(db.folders, item.folderId);
    if (!folder) return;
    const id = nanoid(10);
    dispatch({
      type: "batch",
      ops: [
        {
          type: "createItem",
          item: newItem({
            id,
            folderId: folder.id,
            title: text,
            statusId: resolvedOpen(db, folder)?.id ?? null,
          }),
        },
        {
          type: "addDependency",
          id: nanoid(10),
          itemId: item.id,
          dependsOnId: id,
        },
      ],
    });
    onDone();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        createWaiting();
      }}
    >
      <input
        className={control}
        autoFocus
        placeholder={mode === "wait" ? "Hledat, nebo nový úkol" : "Hledat položku"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={cx(
            "flex w-full items-center gap-2 px-1 py-1 text-left text-sm",
            hoverRow
          )}
          onClick={() => pick(entry.id)}
        >
          <span className="min-w-0 flex-1 truncate">{entry.title}</span>
          <OpenMark />
        </button>
      ))}
      {mode === "wait" && query.trim() && (
        <button
          type="submit"
          className={cx(
            "flex w-full items-center gap-2 px-1 py-1 text-left text-sm text-accent",
            hoverRow
          )}
        >
          <Plus size={14} />
          <span className="min-w-0 flex-1 truncate">Vytvořit „{query.trim()}“</span>
        </button>
      )}
    </form>
  );
}
