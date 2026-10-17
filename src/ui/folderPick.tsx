import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSnap } from "../data/store.tsx";
import { childFolders, folderTrail } from "../domain/select.ts";
import { fold } from "../domain/text.ts";
import type { Db, Folder } from "../domain/types.ts";
import { FolderGlyph } from "./folders.tsx";
import { control, cx } from "./ui.tsx";

type Row = {
  id: string | null;
  depth: number;
  folder: Folder | null;
};

export function FolderPicker({
  value,
  onPick,
  excludeIds,
  allowRoot = false,
  rootLabel = "Nejvyšší úroveň",
}: {
  value: string | null;
  onPick: (id: string | null) => void;
  excludeIds?: string[];
  allowRoot?: boolean;
  rootLabel?: string;
}) {
  const { db } = useSnap();
  const exclude = new Set(excludeIds ?? []);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const expanded = open ?? defaultOpen(db, value, exclude);
  const needle = fold(query.trim());
  const rows = needle
    ? searchRows(db, needle, exclude, allowRoot, rootLabel)
    : treeRows(db, expanded, exclude, allowRoot);
  const active = rows.length === 0 ? 0 : Math.min(cursor, rows.length - 1);
  useEffect(() => {
    list.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, needle]);
  const pick = (id: string | null) => onPick(id);
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  return (
    <div className="grid gap-2">
      <input
        className={control}
        aria-label="Hledat složku"
        placeholder="Hledat složku"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "ArrowDown" &&
            event.key !== "ArrowUp" &&
            event.key !== "Enter"
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "ArrowDown") {
            setCursor(Math.min(rows.length - 1, active + 1));
            return;
          }
          if (event.key === "ArrowUp") {
            setCursor(Math.max(0, active - 1));
            return;
          }
          const row = rows[active];
          if (row) pick(row.id);
        }}
      />
      <div
        ref={list}
        role="listbox"
        aria-label="Složky"
        className="max-h-56 overflow-y-auto rounded-md border border-line"
      >
        {rows.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted">Nic nenalezeno.</p>
        )}
        {rows.map((row, index) => {
          const selected = row.id === value;
          const children = row.folder ? visibleChildren(db, row.folder.id, exclude) : [];
          const isOpen = row.folder ? expanded.has(row.folder.id) : false;
          return (
            <button
              key={row.id ?? "root"}
              type="button"
              role="option"
              aria-selected={selected}
              data-active={index === active ? "" : undefined}
              className={cx(
                "flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-sm",
                index === active && !selected && "bg-black/[0.04] dark:bg-white/[0.06]",
                selected && "bg-accent-soft text-accent"
              )}
              style={{ paddingLeft: 8 + row.depth * 16 }}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(row.id)}
            >
              {row.folder && children.length > 0 && !needle ? (
                <span
                  className="grid size-5 shrink-0 place-items-center text-muted"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggle(row.folder!.id);
                  }}
                >
                  <ChevronRight
                    size={14}
                    className={cx("transition", isOpen && "rotate-90")}
                  />
                </span>
              ) : (
                <span className="size-5 shrink-0" />
              )}
              {row.folder ? (
                <FolderGlyph color={row.folder.color} className="h-5" />
              ) : null}
              <span className={cx("min-w-0 truncate", selected && "text-accent")}>
                {needle && row.folder && (
                  <Trail db={db} folderId={row.folder.id} />
                )}
                {row.folder ? row.folder.name : rootLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Trail({ db, folderId }: { db: Db; folderId: string }) {
  const parents = folderTrail(db, folderId).slice(0, -1);
  if (parents.length === 0) return null;
  return <span className="text-muted">{parents.map((folder) => folder.name).join(" / ")} / </span>;
}

function defaultOpen(db: Db, value: string | null, exclude: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const folder of childFolders(db, null)) {
    if (exclude.has(folder.id)) continue;
    if (visibleChildren(db, folder.id, exclude).length > 0) next.add(folder.id);
  }
  for (const folder of folderTrail(db, value)) {
    if (folder.id !== value) next.add(folder.id);
  }
  return next;
}

function visibleChildren(db: Db, parentId: string, exclude: Set<string>): Folder[] {
  return childFolders(db, parentId).filter((folder) => !exclude.has(folder.id));
}

function treeRows(
  db: Db,
  open: Set<string>,
  exclude: Set<string>,
  allowRoot: boolean
): Row[] {
  const rows: Row[] = [];
  if (allowRoot) rows.push({ id: null, depth: 0, folder: null });
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(db, parentId)) {
      if (exclude.has(folder.id)) continue;
      rows.push({ id: folder.id, depth, folder });
      if (open.has(folder.id)) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function searchRows(
  db: Db,
  needle: string,
  exclude: Set<string>,
  allowRoot: boolean,
  rootLabel: string
): Row[] {
  const rows: Row[] = [];
  if (allowRoot && fold(rootLabel).includes(needle)) {
    rows.push({ id: null, depth: 0, folder: null });
  }
  const folders = childFolders(db, null)
    .flatMap((folder) => flatten(db, folder))
    .filter((folder) => !exclude.has(folder.id))
    .filter((folder) =>
      folderTrail(db, folder.id).some((part) => fold(part.name).includes(needle))
    );
  for (const folder of folders) rows.push({ id: folder.id, depth: 0, folder });
  return rows;
}

function flatten(db: Db, folder: Folder): Folder[] {
  return [folder, ...childFolders(db, folder.id).flatMap((child) => flatten(db, child))];
}
