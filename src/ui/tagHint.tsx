import { nanoid } from "nanoid";
import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { dispatch, useSnap } from "../data/store.tsx";
import { taskTextOps } from "../domain/hashtags.ts";
import {
  suggestTags,
  tagQueryExact,
  tokenAtCaret,
  type TagHint,
} from "../domain/quickAdd.ts";
import type { Db, Item } from "../domain/types.ts";
import { cx } from "./ui.tsx";

export type TagKeyResult = { handled: false } | { handled: true; name?: string };

export function dispatchTaskText(
  db: Db,
  item: Item,
  patch: { title?: string; body?: string | null },
  names: string[]
) {
  const ops = taskTextOps(db, item, patch, names, () => nanoid(10));
  if (ops.length === 0) return;
  const [only] = ops;
  dispatch(ops.length === 1 && only ? only : { type: "batch", ops });
}

export function useTagHint(text: string, caret: number) {
  const { db } = useSnap();
  const [highlight, setHighlight] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const token = tokenAtCaret(text, caret);
  const active = token?.kind === "tag" ? token : null;
  const tokenKey = active ? `${active.start}:${active.query}` : "";
  const tags =
    active && !tagQueryExact(db, active.query) ? suggestTags(db, active.query) : [];
  const open = active !== null && dismissedKey !== tokenKey && tags.length > 0;
  const picked = Math.min(highlight, Math.max(tags.length - 1, 0));
  useEffect(() => {
    setHighlight(0);
  }, [tokenKey]);
  const onKey = (event: ReactKeyboardEvent): TagKeyResult => {
    if (!open) return { handled: false };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => {
        const current = Math.min(index, tags.length - 1);
        return (current + step + tags.length) % tags.length;
      });
      return { handled: true };
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const name = tags[picked]?.name;
      return name ? { handled: true, name } : { handled: true };
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedKey(tokenKey);
      return { handled: true };
    }
    return { handled: false };
  };
  return { open, tags, picked, token: active, setHighlight, onKey };
}

export function TagMenu({
  anchor,
  tags,
  picked,
  onHover,
  onPick,
}: {
  anchor: HTMLElement | null;
  tags: TagHint[];
  picked: number;
  onHover: (index: number) => void;
  onPick: (name: string) => void;
}) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const update = () => redraw((value) => value + 1);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const roomBelow = window.innerHeight - rect.bottom;
  const above = roomBelow < Math.min(tags.length, 8) * 36 + 8;
  const style: CSSProperties = { left: rect.left };
  if (above) style.bottom = window.innerHeight - rect.top + 4;
  else style.top = rect.bottom + 4;
  return createPortal(
    <div
      role="listbox"
      aria-label="Tagy"
      className="fixed z-50 w-64 overflow-hidden rounded-lg border border-line bg-raised shadow-[var(--shadow)]"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      {tags.map((tag, index) => (
        <button
          key={tag.id}
          type="button"
          role="option"
          aria-selected={index === picked}
          className={cx(
            "flex w-full items-center px-3 py-1.5 text-left text-sm",
            index === picked ? "bg-accent-soft" : "hover:bg-black/5 dark:hover:bg-white/10"
          )}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(tag.name)}
        >
          <span className="min-w-0 truncate text-accent">#{tag.name}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
