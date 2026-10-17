import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatch, useSnap } from "../data/store.tsx";
import { formatDay, todayKey } from "../domain/dates.ts";
import { byId, inboxFolder, resolvedOpen } from "../domain/db.ts";
import type { DateRole } from "../domain/op.ts";
import {
  lineAt,
  opsFromTaskLines,
  parseQuickAdd,
  slashQueryExact,
  suggestSlashFolders,
  suggestTags,
  tagQueryExact,
  tokenAtCaret,
  type Chip,
  type SlashFolder,
  type TagHint,
} from "../domain/quickAdd.ts";
import {
  activeFolders,
  folderTrail,
  suggestFolders,
} from "../domain/select.ts";
import { Dot } from "./folders.tsx";
import { useUi } from "./state.tsx";
import { Button, control, cx, Dialog } from "./ui.tsx";

export function QuickAdd() {
  const { db } = useSnap();
  const ui = useUi();
  const quick = ui.quick;
  const [text, setText] = useState(quick?.text ?? "");
  const [caret, setCaret] = useState((quick?.text ?? "").length);
  const [role, setRole] = useState<DateRole>("due");
  const [folderOverride, setFolderOverride] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const today = todayKey();
  const currentLine = lineAt(text, caret).text;
  const parsed = useMemo(
    () => parseQuickAdd(currentLine, db, today),
    [currentLine, db, today]
  );
  const token = tokenAtCaret(text, caret);
  const tokenKey = token ? `${token.kind}:${token.start}:${token.query}` : "";
  const slashMatches =
    token?.kind === "folder" && !slashQueryExact(db, token.query)
      ? suggestSlashFolders(db, token.query)
      : [];
  const tagMatches =
    token?.kind === "tag" && !tagQueryExact(db, token.query)
      ? suggestTags(db, token.query)
      : [];
  const options = token?.kind === "tag" ? tagMatches : slashMatches;
  const suggesting = token !== null && dismissedKey !== tokenKey && options.length > 0;
  const picked = Math.min(highlight, Math.max(options.length - 1, 0));

  useEffect(() => {
    setHighlight(0);
  }, [tokenKey]);

  useEffect(() => {
    const node = area.current;
    const next = pendingCaret.current;
    if (!node || next === null) return;
    pendingCaret.current = null;
    node.focus();
    node.setSelectionRange(next, next);
    setCaret(next);
  }, [text]);
  const currentFolderId =
    parsed.folderId ?? folderOverride ?? quick?.folderId ?? null;
  const suggestions = suggestFolders(db, parsed.title).filter(
    (folder) => folder.id !== currentFolderId
  );
  if (!quick) return null;

  const removeChip = (chip: Chip) => {
    const line = lineAt(text, caret);
    const next = `${line.text.slice(0, chip.start)}${line.text.slice(chip.end)}`
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    setText(`${text.slice(0, line.start)}${next}${text.slice(line.end)}`);
  };

  const submit = () => {
    const inbox = inboxFolder(db);
    if (!inbox) return;
    const folderId = folderOverride ?? quick.folderId ?? inbox.id;
    const folder = byId(db.folders, folderId) ?? inbox;
    const statusId =
      quick.statusId && quick.folderId === folder.id
        ? quick.statusId
        : resolvedOpen(db, folder)?.id ?? null;
    const { ops, itemIds } = opsFromTaskLines(db, text, {
      folderId: folder.id,
      statusId,
      dateRole: role,
      applyRules: folder.system === "inbox",
      ids: () => nanoid(10),
      today,
    });
    if (itemIds.length === 0) return;
    const next = dispatch({ type: "batch", ops });
    const moved = itemIds
      .map((id) => byId(next.items, id))
      .filter((item) => item && item.folderId !== inbox.id);
    if (folder.system === "inbox" && moved.length === 1) {
      const home = byId(next.folders, moved[0]?.folderId ?? null);
      ui.pushToast(home ? `Zařazeno do ${home.name}` : "Zařazeno", true);
    } else if (folder.system === "inbox" && moved.length > 1) {
      ui.pushToast("Zařazeno podle pravidel.", true);
    }
    ui.select(itemIds.length === 1 ? itemIds[0] ?? null : null);
    ui.closeQuick();
  };

  const acceptToken = (insertion: string) => {
    if (!token) return;
    const after = text.slice(token.end);
    const withSpace =
      after.length > 0 && !/^\s/.test(after) ? `${insertion} ` : insertion;
    pendingCaret.current = token.start + withSpace.length;
    setText(`${text.slice(0, token.start)}${withSpace}${after}`);
    setDismissedKey(null);
  };

  const acceptFolder = (folder: SlashFolder) => acceptToken(folder.token);
  const acceptTag = (tag: TagHint) => acceptToken(`#${tag.name}`);

  const onSuggestKey = (event: KeyboardEvent) => {
    if (!suggesting || event.defaultPrevented) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => {
        const current = Math.min(index, options.length - 1);
        return (current + step + options.length) % options.length;
      });
      return true;
    }
    if (
      event.key === "Enter" &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      if (token?.kind === "tag") {
        const tag = tagMatches[picked];
        if (tag) acceptTag(tag);
      } else {
        const folder = slashMatches[picked];
        if (folder) acceptFolder(folder);
      }
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedKey(tokenKey);
      return true;
    }
    return false;
  };

  return (
    <Dialog
      title="Nová položka"
      onClose={ui.closeQuick}
      onConfirm={submit}
      onKeyDown={onSuggestKey}
    >
      <textarea
        ref={area}
        autoFocus
        className={`${control} min-h-28`}
        placeholder="Jeden úkol na řádek."
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setCaret(event.target.selectionStart ?? 0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => {
          if (onSuggestKey(event.nativeEvent)) event.stopPropagation();
        }}
      />
      {suggesting && token?.kind === "folder" && (
        <div
          role="listbox"
          aria-label="Složky"
          className="mt-2 overflow-hidden rounded-2xl border border-line"
        >
          {slashMatches.map((folder, index) => (
            <button
              key={folder.id}
              type="button"
              role="option"
              aria-selected={index === picked}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                index === picked
                  ? "bg-accent-soft text-accent"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => acceptFolder(folder)}
            >
              <Dot color={folder.color} icon={folder.icon} />
              <span className="min-w-0 truncate">{folder.label}</span>
            </button>
          ))}
        </div>
      )}
      {suggesting && token?.kind === "tag" && (
        <div
          role="listbox"
          aria-label="Tagy"
          className="mt-2 overflow-hidden rounded-2xl border border-line"
        >
          {tagMatches.map((tag, index) => (
            <button
              key={tag.id}
              type="button"
              role="option"
              aria-selected={index === picked}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                index === picked
                  ? "bg-accent-soft"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => acceptTag(tag)}
            >
              <span className="min-w-0 truncate text-accent">#{tag.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {parsed.chips
          .filter(
            (chip) =>
              !(
                suggesting &&
                token &&
                ((chip.kind === "folderMissing" && token.kind === "folder") ||
                  (chip.kind === "tag" && token.kind === "tag")) &&
                chip.start >= token.start &&
                chip.end <= token.end
              )
          )
          .map((chip) => (
            <button
              key={`${chip.kind}-${chip.start}`}
              type="button"
              className="rounded-sm bg-accent-soft px-2 py-1 text-xs text-accent"
              onClick={() => removeChip(chip)}
            >
              {chip.kind === "date"
                ? formatDay(chip.label, today)
                : chip.kind === "horizon"
                  ? `plán ${chip.label}`
                  : chip.label}{" "}
              ×
            </button>
          ))}
      </div>
      {parsed.dueDay && (
        <div className="mt-3 flex gap-2">
          <Button
            tone={role === "due" ? "soft" : "ghost"}
            onClick={() => setRole("due")}
          >
            Termín
          </Button>
          <Button
            tone={role === "plan" ? "soft" : "ghost"}
            onClick={() => setRole("plan")}
          >
            Plán
          </Button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {suggestions.map((folder) => (
            <Button
              key={folder.id}
              tone={folderOverride === folder.id ? "soft" : "ghost"}
              onClick={() => setFolderOverride(folder.id)}
            >
              {folderTrail(db, folder.id)
                .map((part) => part.name)
                .join(" / ")}
            </Button>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        {folderTrail(
          db,
          parsed.folderId ??
            folderOverride ??
            quick.folderId ??
            inboxFolder(db)?.id ??
            null
        )
          .map((part) => part.name)
          .join(" / ") || "Nezařazené"}
        {" · "}
        {activeFolders(db).length > 0
          ? "Složku najdeš lomítkem, třeba /Dům. Tag mřížkou, třeba #nákup. Šipky a Enter vyberou našeptanou."
          : ""}
      </p>
      <div className="mt-4 flex justify-end">
        <Button tone="solid" data-primary onClick={submit}>
          Uložit
        </Button>
      </div>
    </Dialog>
  );
}
