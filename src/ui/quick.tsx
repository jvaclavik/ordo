import { Check } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatch, useSnap } from "../data/store.tsx";
import { formatDay, todayKey } from "../domain/dates.ts";
import { byId, inboxFolder, resolvedOpen } from "../domain/db.ts";
import { newItem } from "../domain/factory.ts";
import { splitNoteDraft } from "../domain/noteIntent.ts";
import {
  lineAt,
  opsFromTaskDraft,
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
import { DictateButton } from "./dictate.tsx";
import { registerDraftFolderUndo } from "./draftFolder.ts";
import { Dot } from "./folders.tsx";
import { placeCreated } from "./move.ts";
import { useUi, type QuickKind } from "./state.tsx";
import { Button, control, cx, Dialog, TagMark } from "./ui.tsx";

export function QuickAdd() {
  const { db } = useSnap();
  const ui = useUi();
  const quick = ui.quick;
  const [text, setText] = useState(quick?.text ?? "");
  const [kind, setKind] = useState<QuickKind>(quick?.kind ?? "task");
  const [caret, setCaret] = useState((quick?.text ?? "").length);
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
  const suggesting =
    token !== null && dismissedKey !== tokenKey && options.length > 0;
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
  const suggestions = suggestFolders(db, parsed.title).filter(
    (folder) => folder.id !== (parsed.folderId ?? quick?.folderId ?? null)
  );
  useEffect(() => {
    return registerDraftFolderUndo(
      () => folderOverride !== null,
      () => setFolderOverride(null)
    );
  }, [folderOverride]);
  if (!quick) return null;

  const removeChip = (chip: Chip) => {
    const line = lineAt(text, caret);
    const next = `${line.text.slice(0, chip.start)}${line.text.slice(chip.end)}`
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    setText(`${text.slice(0, line.start)}${next}${text.slice(line.end)}`);
  };

  const submitNote = () => {
    const inbox = inboxFolder(db);
    if (!inbox) return;
    const draft = splitNoteDraft(text);
    if (!draft) return;
    const folder = byId(db.folders, quick.folderId) ?? inbox;
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
    if (!byId(next.items, id)) return;
    ui.pushToast("Poznámka uložena", true);
    ui.select(id);
    ui.closeQuick();
  };

  const submit = () => {
    if (kind === "note") {
      submitNote();
      return;
    }
    const inbox = inboxFolder(db);
    if (!inbox) return;
    const base = byId(db.folders, quick.folderId) ?? inbox;
    const folder = byId(db.folders, folderOverride ?? base.id) ?? base;
    const filing = folderOverride !== null && folder.id !== base.id;
    const home = filing ? base : folder;
    const statusId =
      !filing && quick.statusId && quick.folderId === folder.id
        ? quick.statusId
        : resolvedOpen(db, home)?.id ?? null;
    const { ops, itemIds } = opsFromTaskDraft(db, text, {
      folderId: home.id,
      statusId,
      dateRole: "due",
      applyRules: !filing && folder.system === "inbox",
      ids: () => nanoid(10),
      today,
    });
    if (itemIds.length === 0) return;
    const created = dispatch({ type: "batch", ops });
    const fileOps = filing ? placeCreated(created, itemIds, folder.id) : [];
    const next =
      fileOps.length > 0 ? dispatch({ type: "batch", ops: fileOps }) : created;
    if (fileOps.length > 0) {
      ui.pushToast(`Zařazeno do ${folder.name}`, true);
    } else if (!filing && folder.system === "inbox") {
      const moved = itemIds
        .map((id) => byId(next.items, id))
        .filter((item) => item && item.folderId !== inbox.id);
      if (moved.length === 1) {
        const ruleHome = byId(next.folders, moved[0]?.folderId ?? null);
        ui.pushToast(
          ruleHome ? `Zařazeno do ${ruleHome.name}` : "Zařazeno",
          true
        );
      } else if (moved.length > 1) {
        ui.pushToast("Zařazeno podle pravidel.", true);
      }
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
    if (kind === "note" || !suggesting || event.defaultPrevented) return false;
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
      title={kind === "note" ? "Nová poznámka" : "Přidat"}
      onClose={ui.closeQuick}
      onConfirm={submit}
      onKeyDown={onSuggestKey}
    >
      <div
        className="mb-3 flex rounded-md bg-black/5 p-0.5 dark:bg-white/10"
        role="group"
        aria-label="Co přidat"
      >
        {(
          [
            ["task", "Úkol"],
            ["note", "Poznámka"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            className={cx(
              "flex-1 rounded-sm px-3 py-1.5 text-sm",
              kind === value
                ? "bg-accent text-accent-ink"
                : "text-muted hover:text-ink"
            )}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative">
        <textarea
          ref={area}
          autoFocus
          className={cx(control, "min-h-28", kind === "task" && "pr-12")}
          placeholder={
            kind === "note"
              ? "První řádek je název."
              : "První řádek je název. Shift+Enter přidá popis."
          }
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? 0);
          }}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onKeyDown={(event) => {
            if (onSuggestKey(event.nativeEvent)) {
              event.stopPropagation();
              return;
            }
            if (
              kind !== "task" ||
              event.key !== "Enter" ||
              event.shiftKey ||
              event.altKey ||
              event.metaKey ||
              event.ctrlKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            submit();
          }}
        />
        {kind === "task" && (
          <div className="absolute right-1.5 bottom-1.5">
            <DictateButton
              value={text}
              onChange={(next) => {
                setText(next);
                setCaret(next.length);
              }}
            />
          </div>
        )}
      </div>
      {kind === "task" && suggesting && token?.kind === "folder" && (
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
      {kind === "task" && suggesting && token?.kind === "tag" && (
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
              <TagMark name={tag.name} color={tag.color} />
            </button>
          ))}
        </div>
      )}
      {kind === "task" && (
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
                  : chip.label}{" "}
                ×
              </button>
            ))}
        </div>
      )}
      {kind === "task" && suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {suggestions.map((folder) => {
            const selected = folderOverride === folder.id;
            return (
              <Button
                key={folder.id}
                tone={selected ? "solid" : "ghost"}
                aria-pressed={selected}
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
      <p className="mt-3 text-xs text-muted">
        {folderTrail(
          db,
          kind === "note"
            ? quick.folderId ?? inboxFolder(db)?.id ?? null
            : parsed.folderId ??
                folderOverride ??
                quick.folderId ??
                inboxFolder(db)?.id ??
                null
        )
          .map((part) => part.name)
          .join(" / ") || "Nezařazené"}
        {kind === "task" && activeFolders(db).length > 0 && (
          <>
            {" · "}
            Složku najdeš lomítkem nebo slovem složka, štítek mřížkou, hashtagem
            nebo štítkem. Čas třeba v 9 hodin. Šipky a Enter vyberou našeptanou.
          </>
        )}
        {kind === "note" && " · První řádek je název, zbytek text poznámky."}
      </p>
      <div className="mt-4 flex justify-end">
        <Button tone="solid" data-primary onClick={submit}>
          Uložit
        </Button>
      </div>
    </Dialog>
  );
}
