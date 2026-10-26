import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  applyBackspace,
  applyEnter,
  applyFormat,
  applyIndent,
  applyPaste,
  applySourceRange,
  applyText,
  blockText,
  locateCaret,
  parseDocument,
  parseInline,
  serializeDocument,
  sourceCaret,
  TEXT_COLORS,
  type Block,
  type Edit,
  type FormatAction,
  type Inline,
} from "../domain/markdownDoc.ts";
import { createPortal } from "react-dom";
import { cx } from "./ui.tsx";

const EditorHost = memo(
  forwardRef<
    HTMLDivElement,
    { label?: string | undefined; taskBody?: boolean | undefined }
  >(function EditorHost({ label, taskBody }, ref) {
    return (
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        {...(label ? { "aria-label": label } : {})}
        {...(taskBody ? { "data-task-body": "" } : {})}
        className="note-md md-doc grid min-h-full flex-1 cursor-text gap-1 outline-none"
      />
    );
  }),
  () => true
);

export type MarkdownHandle = {
  focus: (caret?: number) => void;
  format: (action: FormatAction) => void;
};

export type LinkHit = { id: string; title: string; kind: "task" | "note" };

type Density = "page" | "inline";

export const MarkdownField = forwardRef<
  MarkdownHandle,
  {
    value: string;
    onChange?: (value: string, caret: number) => void;
    onCaret?: (caret: number, anchor: HTMLElement) => void;
    onSelection?: (text: string) => void;
    onBlur?: (event: { relatedTarget: EventTarget | null }) => void;
    onEscape?: () => void;
    onExit?: (dir: -1 | 1, column: number) => void;
    editable?: boolean;
    density?: Density;
    placeholder?: string;
    tailPlaceholder?: string;
    leadClassName?: string;
    label?: string;
    autoFocus?: boolean;
    className?: string;
    caret?: number | null;
    taskBody?: boolean;
    embed?: (id: string) => ReactNode;
    formats?: boolean;
    suggest?: (query: string) => LinkHit[];
  }
>(function MarkdownField(
  {
    value,
    onChange,
    onCaret,
    onSelection,
    onBlur,
    onEscape,
    onExit,
    editable = true,
    density = "page",
    placeholder,
    tailPlaceholder,
    leadClassName,
    label,
    autoFocus = false,
    className,
    caret = null,
    taskBody = false,
    embed,
    formats = false,
    suggest,
  },
  ref
) {
  const root = useRef<HTMLDivElement>(null);
  const emitted = useRef(value);
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const [doc, setDoc] = useState(() => parseDocument(value));
  const [live, setLive] = useState<{ index: number; caret: number } | null>(
    null
  );
  const [intent, setIntent] = useState(0);
  const [embedNodes, setEmbedNodes] = useState<
    { id: string; node: HTMLElement }[]
  >([]);
  const grabRef = useRef(false);
  const formatRef = useRef<(action: FormatAction) => void>(() => {});
  const formatsRef = useRef(formats);
  formatsRef.current = formats;
  const savedSel = useRef<{ anchor: CaretPoint; focus: CaretPoint } | null>(
    null
  );
  const selectRef = useRef<{ start: CaretPoint; end: CaretPoint } | null>(
    null
  );
  const [bar, setBar] = useState<{
    top: number;
    left: number;
    below: boolean;
  } | null>(null);
  const place = () => setIntent((n) => n + 1);
  const docRef = useRef(doc);
  docRef.current = doc;
  const changeRef = useRef(onChange);
  const caretCb = useRef(onCaret);
  const selectCb = useRef(onSelection);
  const escapeRef = useRef(onEscape);
  const exitRef = useRef(onExit);
  changeRef.current = onChange;
  caretCb.current = onCaret;
  selectCb.current = onSelection;
  escapeRef.current = onEscape;
  exitRef.current = onExit;

  useEffect(() => {
    if (value === emitted.current) return;
    const blocks = parseDocument(value);
    emitted.current = value;
    setDoc(blocks);
    const at = caretRef.current;
    if (typeof at === "number") {
      setLive(locateCaret(blocks, at));
      place();
    } else setLive(null);
  }, [value]);

  const didFocus = useRef(false);
  useEffect(() => {
    if (didFocus.current || !autoFocus || !editable) return;
    didFocus.current = true;
    const block = docRef.current[0];
    if (!block) return;
    setLive({ index: 0, caret: blockText(block).length });
    place();
  }, [autoFocus, editable]);

  useEffect(() => {
    if (!editable) return;
    const onPointerDown = (event: PointerEvent) => {
      const box = root.current;
      const target = event.target;
      if (!box || !(target instanceof Node) || box.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, button, a, [contenteditable='true'], [role=listbox], [data-format-bar]"
        )
      )
        return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !box.contains(active)) return;
      active.blur();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [editable]);

  useEffect(() => {
    if (!editable || !formats) return;
    const onSel = () => {
      const box = root.current;
      const sel = box ? selectionIn(box) : null;
      if (sel) savedSel.current = sel;
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editable, formats]);

  useEffect(() => {
    if (!bar) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-format-bar]"))
        return;
      setBar(null);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [bar]);

  useImperativeHandle(ref, () => ({
    focus(caret?: number) {
      const block = docRef.current[0];
      const len = block ? blockText(block).length : 0;
      const at = caret == null ? 0 : Math.max(0, Math.min(caret, len));
      grabRef.current = true;
      setLive({ index: 0, caret: at });
      place();
    },
    format(action) {
      formatRef.current(action);
    },
  }));

  const composing = useRef(false);
  const enterFromKey = useRef(false);
  const commit = (edit: Edit) => {
    docRef.current = edit.blocks;
    const source = serializeDocument(edit.blocks);
    emitted.current = source;
    setDoc(edit.blocks);
    setLive({ index: edit.index, caret: edit.caret });
    place();
    const at = sourceCaret(edit.blocks, edit.index, edit.caret);
    changeRef.current?.(source, at);
    const anchor = root.current?.querySelector<HTMLElement>(
      `[data-md-line="${edit.index}"]`
    );
    if (anchor) caretCb.current?.(at, anchor);
  };
  const points = () => {
    const box = root.current;
    return box ? selectionIn(box) : null;
  };
  formatRef.current = (action) => {
    const range = points() ?? savedSel.current;
    if (!range) return;
    const { start, end } = orderedRange(range.anchor, range.focus);
    const next = applyFormat(docRef.current, start, end, action);
    if (!next) return;
    if (next.select) {
      const kept = {
        start: { index: next.select.index, caret: next.select.from },
        end: { index: next.select.endIndex, caret: next.select.to },
      };
      selectRef.current = kept;
      savedSel.current = { anchor: kept.start, focus: kept.end };
    } else {
      selectRef.current = null;
      savedSel.current = {
        anchor: { index: next.index, caret: next.caret },
        focus: { index: next.index, caret: next.caret },
      };
    }
    grabRef.current = true;
    commit(next);
  };
  const syncBar = (sel: { anchor: CaretPoint; focus: CaretPoint } | null) => {
    if (!formatsRef.current) return;
    if (sel) savedSel.current = sel;
    const native = window.getSelection();
    const { start, end } = sel
      ? orderedRange(sel.anchor, sel.focus)
      : { start: null, end: null };
    const open = Boolean(
      start &&
        end &&
        (start.index !== end.index || start.caret !== end.caret) &&
        native &&
        !native.isCollapsed &&
        native.rangeCount > 0
    );
    if (!open || !native) {
      setBar(null);
      return;
    }
    const rect = native.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setBar(null);
      return;
    }
    const below = rect.top < 56;
    setBar({
      top: below ? rect.bottom + 8 : rect.top - 8,
      left: Math.min(
        Math.max(12, rect.left + rect.width / 2),
        window.innerWidth - 12
      ),
      below,
    });
  };
  const syncCaret = (): Edit | null => {
    const box = root.current;
    const sel = points();
    if (!box || !sel) return null;
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    const blocks = docRef.current;
    if (start.index !== end.index || start.caret !== end.caret) {
      return applySourceRange(
        blocks,
        sourceCaret(blocks, start.index, start.caret),
        sourceCaret(blocks, end.index, end.caret),
        ""
      );
    }
    const line = box.querySelector<HTMLElement>(
      `[data-md-line="${start.index}"]`
    );
    if (!line) return { blocks, index: start.index, caret: start.caret };
    const read = readRoot(line);
    return applyText(
      blocks,
      start.index,
      read.source.slice(0, read.start) + read.source.slice(read.end),
      read.start
    );
  };
  const flushLine = () => {
    if (composing.current) return;
    const box = root.current;
    if (!box) return;
    if (!box.querySelector("[data-md-line]")) {
      const blocks = parseDocument(box.innerText.replace(/\u00a0/g, " "));
      const index = Math.max(0, blocks.length - 1);
      const block = blocks[index];
      commit({
        blocks,
        index,
        caret: block ? blockText(block).length : 0,
      });
      return;
    }
    const sel = points();
    if (!sel) return;
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    if (start.index !== end.index || start.caret !== end.caret) return;
    const line = box.querySelector<HTMLElement>(
      `[data-md-line="${start.index}"]`
    );
    if (!line) return;
    const read = readRoot(line);
    if (read.start !== read.end) return;
    const block = docRef.current[start.index];
    if (!block || read.source === blockText(block)) return;
    commit(applyText(docRef.current, start.index, read.source, read.start));
  };
  const report = () => {
    const box = root.current;
    const sel = box ? selectionIn(box) : null;
    syncBar(sel);
    if (!box || !sel) {
      selectCb.current?.("");
      return;
    }
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    selectCb.current?.(
      start.index === end.index && start.caret === end.caret
        ? ""
        : plainBetween(docRef.current, start, end)
    );
    const line = box.querySelector<HTMLElement>(
      `[data-md-line="${sel.focus.index}"]`
    );
    if (!line) return;
    caretCb.current?.(
      sourceCaret(docRef.current, sel.focus.index, sel.focus.caret),
      line
    );
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const native = event.nativeEvent ?? event;
    if (native.isComposing || composing.current) return;
    if (
      formatsRef.current &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const key = event.key.toLowerCase();
      const mark =
        key === "b" ? "strong" : key === "i" ? "em" : key === "u" ? "underline" : null;
      if (mark) {
        event.preventDefault();
        event.stopPropagation();
        formatRef.current({ type: "mark", mark });
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      escapeRef.current?.();
      root.current?.blur();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      enterFromKey.current = true;
      const written = syncCaret();
      if (written) commit(applyEnter(written.blocks, written.index, written.caret));
      return;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const sel = points();
      if (!sel) return;
      const { start, end } = orderedRange(sel.anchor, sel.focus);
      if (start.index !== end.index || start.caret !== end.caret) {
        event.preventDefault();
        event.stopPropagation();
        const blocks = docRef.current;
        commit(
          applySourceRange(
            blocks,
            sourceCaret(blocks, start.index, start.caret),
            sourceCaret(blocks, end.index, end.caret),
            ""
          )
        );
        return;
      }
      if (event.key === "Backspace" && start.caret === 0) {
        event.preventDefault();
        event.stopPropagation();
        const written = syncCaret() ?? {
          blocks: docRef.current,
          index: start.index,
          caret: 0,
        };
        const next = applyBackspace(written.blocks, written.index, 0);
        if (next) commit(next);
        return;
      }
      if (event.key === "Delete") {
        const written = syncCaret();
        const blocks = written?.blocks ?? docRef.current;
        const index = written?.index ?? start.index;
        const caret = written?.caret ?? start.caret;
        const block = blocks[index];
        if (!block || caret < blockText(block).length) return;
        let to = index + 1;
        while (blocks[to] && !lineBlock(blocks[to]!)) to += 1;
        if (!blocks[to]) return;
        event.preventDefault();
        event.stopPropagation();
        if (written) commit(written);
        const next = applyBackspace(docRef.current, to, 0);
        if (next) commit(next);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const sel = points();
      if (!sel) return;
      const { start, end } = orderedRange(sel.anchor, sel.focus);
      if (start.index !== end.index) {
        let blocks = docRef.current;
        let changed = false;
        for (let index = start.index; index <= end.index; index += 1) {
          const block = blocks[index];
          if (!block) continue;
          const next = applyIndent(
            blocks,
            index,
            event.shiftKey,
            blockText(block).length
          );
          if (!next) continue;
          blocks = next.blocks;
          changed = true;
        }
        if (changed)
          commit({ blocks, index: start.index, caret: start.caret });
        return;
      }
      const next = applyIndent(
        docRef.current,
        start.index,
        event.shiftKey,
        start.caret
      );
      if (next) {
        commit(next);
        return;
      }
      const dir = event.shiftKey ? -1 : 1;
      let to = start.index + dir;
      while (docRef.current[to] && !lineBlock(docRef.current[to]!)) to += dir;
      const target = docRef.current[to];
      const current = docRef.current[start.index];
      if (!target || !current) {
        exitRef.current?.(
          dir,
          current ? columnInLine(blockText(current), start.caret) : 0
        );
        return;
      }
      grabRef.current = true;
      setLive({
        index: to,
        caret: caretOnLine(
          blockText(target),
          columnInLine(blockText(current), start.caret),
          dir
        ),
      });
      place();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
      return;
    const sel = points();
    if (!sel || !exitRef.current) return;
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    if (start.index !== end.index || start.caret !== end.caret) return;
    const dir = event.key === "ArrowUp" ? -1 : 1;
    let to = start.index + dir;
    while (docRef.current[to] && !lineBlock(docRef.current[to]!)) to += dir;
    if (docRef.current[to]) return;
    const line = root.current?.querySelector<HTMLElement>(
      `[data-md-line="${start.index}"]`
    );
    const current = docRef.current[start.index];
    if (!line || !current || !atVisualEdge(line, dir)) return;
    event.preventDefault();
    event.stopPropagation();
    exitRef.current(dir, columnInLine(blockText(current), start.caret));
  };
  const onBeforeInput = (event: ReactFormEvent<HTMLDivElement>) => {
    if (composing.current) return;
    const native = event.nativeEvent;
    if (!(native instanceof InputEvent) || native.isComposing) return;
    const type = native.inputType;
    if (type === "historyUndo" || type === "historyRedo") {
      window.requestAnimationFrame(flushLine);
      return;
    }
    const sel = points();
    if (!sel) {
      if (type.startsWith("insert") || type.startsWith("delete"))
        event.preventDefault();
      return;
    }
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    const crosses = start.index !== end.index || start.caret !== end.caret;
    if (type === "insertParagraph" || type === "insertLineBreak") {
      event.preventDefault();
      if (enterFromKey.current) {
        enterFromKey.current = false;
        return;
      }
      const written = syncCaret();
      if (written)
        commit(applyEnter(written.blocks, written.index, written.caret));
      return;
    }
    if (type === "insertFromPaste" || type === "insertFromDrop" || type === "deleteByCut") {
      event.preventDefault();
      return;
    }
    if (!crosses || type.startsWith("format")) {
      if (crosses) event.preventDefault();
      return;
    }
    if (!type.startsWith("insert") && !type.startsWith("delete")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const blocks = docRef.current;
    commit(
      applySourceRange(
        blocks,
        sourceCaret(blocks, start.index, start.caret),
        sourceCaret(blocks, end.index, end.caret),
        type.startsWith("insert") ? (native.data ?? "") : ""
      )
    );
  };
  const onCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const sel = points();
    if (!sel) return;
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    if (start.index === end.index && start.caret === end.caret) return;
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      plainBetween(docRef.current, start, end)
    );
  };
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain");
    const sel = points();
    if (!sel) return;
    const { start, end } = orderedRange(sel.anchor, sel.focus);
    if (start.index !== end.index || start.caret !== end.caret) {
      const blocks = docRef.current;
      commit(
        applySourceRange(
          blocks,
          sourceCaret(blocks, start.index, start.caret),
          sourceCaret(blocks, end.index, end.caret),
          pasted
        )
      );
      return;
    }
    const written = syncCaret();
    if (!written) return;
    commit(applyPaste(written.blocks, written.index, written.caret, pasted));
  };

  const keyDownRef = useRef(onKeyDown);
  const beforeRef = useRef(onBeforeInput);
  const flushRef = useRef(flushLine);
  const pasteRef = useRef(onPaste);
  const copyRef = useRef(onCopy);
  keyDownRef.current = onKeyDown;
  beforeRef.current = onBeforeInput;
  flushRef.current = flushLine;
  pasteRef.current = onPaste;
  copyRef.current = onCopy;

  useEffect(() => {
    const host = root.current;
    if (!host || !editable) return;
    const onKey = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      keyDownRef.current(
        event as unknown as ReactKeyboardEvent<HTMLDivElement>
      );
    };
    const onBefore = (event: Event) => {
      if (!(event instanceof InputEvent)) return;
      beforeRef.current({
        nativeEvent: event,
        preventDefault() {
          event.preventDefault();
        },
      } as unknown as ReactFormEvent<HTMLDivElement>);
    };
    const onInput = () => flushRef.current();
    const onPasteEvent = (event: Event) => {
      if (!(event instanceof ClipboardEvent)) return;
      pasteRef.current(
        event as unknown as ReactClipboardEvent<HTMLDivElement>
      );
    };
    const onCopyEvent = (event: Event) => {
      if (!(event instanceof ClipboardEvent)) return;
      copyRef.current(event as unknown as ReactClipboardEvent<HTMLDivElement>);
    };
    const onCutEvent = (event: Event) => {
      if (!(event instanceof ClipboardEvent)) return;
      copyRef.current(event as unknown as ReactClipboardEvent<HTMLDivElement>);
      if (!event.defaultPrevented) return;
      const sel = points();
      if (!sel) return;
      const { start, end } = orderedRange(sel.anchor, sel.focus);
      const blocks = docRef.current;
      commit(
        applySourceRange(
          blocks,
          sourceCaret(blocks, start.index, start.caret),
          sourceCaret(blocks, end.index, end.caret),
          ""
        )
      );
    };
    host.addEventListener("keydown", onKey);
    host.addEventListener("beforeinput", onBefore);
    host.addEventListener("input", onInput);
    host.addEventListener("paste", onPasteEvent);
    host.addEventListener("copy", onCopyEvent);
    host.addEventListener("cut", onCutEvent);
    const onCompStart = () => {
      composing.current = true;
    };
    const onCompEnd = () => {
      composing.current = false;
      flushRef.current();
    };
    host.addEventListener("compositionstart", onCompStart);
    host.addEventListener("compositionend", onCompEnd);
    const onToggle = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox")
        return;
      const index = Number(
        target.closest<HTMLElement>("[data-md-row]")?.dataset.mdRow
      );
      const block = docRef.current[index];
      if (!block || block.kind !== "check") return;
      const blocks = docRef.current.slice();
      blocks[index] = { ...block, checked: target.checked };
      commit({ blocks, index, caret: block.text.length });
    };
    host.addEventListener("change", onToggle);
    return () => {
      host.removeEventListener("keydown", onKey);
      host.removeEventListener("beforeinput", onBefore);
      host.removeEventListener("input", onInput);
      host.removeEventListener("paste", onPasteEvent);
      host.removeEventListener("copy", onCopyEvent);
      host.removeEventListener("cut", onCutEvent);
      host.removeEventListener("compositionstart", onCompStart);
      host.removeEventListener("compositionend", onCompEnd);
      host.removeEventListener("change", onToggle);
    };
  }, [editable]);

  useLayoutEffect(() => {
    if (!editable) return;
    const host = root.current;
    if (!host || composing.current) return;
    paintDocument(host, doc, {
      density,
      placeholder,
      tailPlaceholder,
      leadClassName,
    });
    const slots = [...host.querySelectorAll<HTMLElement>("[data-md-embed]")];
    setEmbedNodes((prev) => {
      if (slots.length === 0 && prev.length === 0) return prev;
      return slots.map((node) => ({
        id: node.dataset.mdEmbed ?? "",
        node,
      }));
    });
    if (live == null) return;
    const line = host.querySelector<HTMLElement>(
      `[data-md-line="${live.index}"]`
    );
    if (!line) return;
    const active = document.activeElement;
    const grab = grabRef.current;
    if (grab) grabRef.current = false;
    const canTake =
      grab ||
      active === host ||
      active === document.body ||
      active == null ||
      (active instanceof Node && host.contains(active));
    if (!canTake) return;
    if (active !== host) host.focus({ preventScroll: true });
    const kept = selectRef.current;
    if (kept) {
      selectRef.current = null;
      placeSelection(host, doc, kept.start, kept.end);
      syncBar({ anchor: kept.start, focus: kept.end });
      return;
    }
    const block = doc[live.index];
    placeCaret(
      line,
      block ? blockText(block) : "",
      live.caret,
      line.hasAttribute("data-plain")
    );
  }, [doc, live, intent, editable, density, placeholder, tailPlaceholder, leadClassName]);

  return (
    <div
      className={cx(
        editable ? "flex min-h-0 flex-col" : "note-md md-doc grid gap-1 outline-none",
        className
      )}
      {...(taskBody && !editable ? { "data-task-body": "" } : {})}
      onMouseDown={(event) => {
        if (!editable || event.button !== 0 || event.target !== root.current)
          return;
        const host = root.current;
        const lines = host?.querySelectorAll<HTMLElement>("[data-md-line]");
        const line = lines && lines.length > 0 ? lines[lines.length - 1] : null;
        if (!host || !line) return;
        event.preventDefault();
        host.focus();
        const plain = line.hasAttribute("data-plain");
        const text = textOf(line, plain);
        placeCaret(line, text, text.length, plain);
      }}
      onMouseUp={editable ? report : undefined}
      onKeyUp={
        editable
          ? () => {
              enterFromKey.current = false;
              report();
            }
          : undefined
      }
      onFocus={() => {
        if (!editable) return;
        window.requestAnimationFrame(() => {
          const box = root.current;
          if (!box || document.activeElement !== box) return;
          const sel = window.getSelection();
          if (sel?.anchorNode && lineNode(sel.anchorNode)) return;
          const line = box.querySelector<HTMLElement>("[data-md-line]");
          if (!line) return;
          const plain = line.hasAttribute("data-plain");
          placeCaret(line, textOf(line, plain), 0, plain);
        });
      }}
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const item = target.closest("a[data-item]");
        if (item) {
          event.preventDefault();
          event.stopPropagation();
          const id = item.getAttribute("data-item");
          if (id)
            document.dispatchEvent(
              new CustomEvent("ordo-open-item", { detail: id })
            );
          return;
        }
        if (!target.closest("a")) return;
        if (editable && !event.metaKey && !event.ctrlKey)
          event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && root.current?.contains(next)) return;
        onBlur?.({ relatedTarget: next });
      }}
    >
      {editable ? (
        <EditorHost ref={root} label={label} taskBody={taskBody} />
      ) : null}
      {formats && bar
        ? createPortal(
            <div
              data-format-bar=""
              className="fixed z-[90]"
              style={{
                top: bar.top,
                left: bar.left,
                transform: bar.below
                  ? "translateX(-50%)"
                  : "translate(-50%, -100%)",
              }}
            >
              <div className="rounded-lg border border-line bg-raised p-1 shadow-[var(--shadow)]">
                <FormatBar
                  onFormat={(action) => formatRef.current(action)}
                  {...(suggest ? { suggest } : {})}
                />
              </div>
            </div>,
            document.body
          )
        : null}
      {editable
        ? null
        : doc.map((block, index) => (
        <BlockRow
          key={index}
          block={block}
          index={index}
          editable={editable}
          density={density}
          placeholder={placeholderFor(block, index, doc, placeholder, tailPlaceholder)}
          leadClassName={index === 0 ? leadClassName : undefined}
          caret={live?.index === index ? live.caret : null}
          intent={intent}
          grabRef={grabRef}
          composing={composing}
          embed={embed}
          onToggle={(checked) => {
            if (block.kind !== "check") return;
            const blocks = docRef.current.slice();
            blocks[index] = { ...block, checked };
            commit({ blocks, index, caret: block.text.length });
          }}
        />
      ))}
      {editable && embed
        ? embedNodes.map((item) => createPortal(embed(item.id), item.node))
        : null}
    </div>
  );
});

function paintDocument(
  host: HTMLElement,
  blocks: Block[],
  opts: {
    density: Density;
    placeholder?: string | undefined;
    tailPlaceholder?: string | undefined;
    leadClassName?: string | undefined;
  }
) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block) fragment.append(paintBlock(block, index, blocks, opts));
  }
  host.replaceChildren(fragment);
}

function paintBlock(
  block: Block,
  index: number,
  blocks: Block[],
  opts: {
    density: Density;
    placeholder?: string | undefined;
    tailPlaceholder?: string | undefined;
    leadClassName?: string | undefined;
  }
) {
  if (block.kind === "task") {
    const row = document.createElement("div");
    row.dataset.mdRow = String(index);
    row.contentEditable = "false";
    const slot = document.createElement("div");
    slot.dataset.mdEmbed = block.id;
    row.append(slot);
    return row;
  }
  if (block.kind === "rule") {
    const row = document.createElement("hr");
    row.dataset.mdRow = String(index);
    row.className = "my-1 border-line";
    row.contentEditable = "false";
    return row;
  }
  const line = document.createElement("div");
  line.dataset.mdLine = String(index);
  if (block.kind === "code") line.dataset.plain = "";
  const hint = placeholderFor(
    block,
    index,
    blocks,
    opts.placeholder,
    opts.tailPlaceholder
  );
  line.dataset.placeholder = hint ?? "";
  line.className = cx(
    "md-line whitespace-pre-wrap",
    index === 0 && block.kind === "p" && opts.leadClassName,
    headingClass(block, opts.density)
  );
  paint(line, block.text, block.kind === "code");
  const indent =
    block.kind === "ul" || block.kind === "ol" || block.kind === "check"
      ? block.indent.length * 0.65
      : 0;
  let marker: HTMLElement | null = null;
  if (block.kind === "ul" || block.kind === "ol") {
    marker = document.createElement("span");
    marker.contentEditable = "false";
    marker.setAttribute("aria-hidden", "true");
    marker.className =
      block.kind === "ul"
        ? "md-bullet"
        : "mt-0.5 w-5 shrink-0 select-none font-medium";
    marker.textContent = block.kind === "ul" ? "" : `${block.n}${block.suffix}`;
    marker.addEventListener("mousedown", (event) => event.preventDefault());
  } else if (block.kind === "check") {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = block.checked;
    box.contentEditable = "false";
    box.className = "mt-1 size-4 shrink-0 accent-[var(--accent)]";
    box.setAttribute("aria-label", block.checked ? "Hotovo" : "Otevřeno");
    box.addEventListener("mousedown", (event) => event.preventDefault());
    marker = box;
  }
  const body = marker ? document.createElement("div") : line;
  if (marker) {
    body.className = "min-w-0 flex-1";
    body.append(line);
  }
  if (block.kind === "code") {
    const pre = document.createElement("pre");
    pre.dataset.mdRow = String(index);
    pre.className = "whitespace-pre-wrap";
    pre.append(line);
    return pre;
  }
  if (block.kind === "quote") {
    const quote = document.createElement("blockquote");
    quote.dataset.mdRow = String(index);
    quote.className = "my-0";
    quote.append(line);
    return quote;
  }
  const row = document.createElement("div");
  row.dataset.mdRow = String(index);
  row.className = cx(
    marker && "flex gap-2",
    block.kind === "check" && block.checked && "text-muted line-through"
  );
  if (indent > 0) row.style.paddingLeft = `${indent}rem`;
  if (marker) row.append(marker, body);
  else row.append(line);
  return row;
}

function BlockRow({
  block,
  index,
  editable,
  density,
  placeholder,
  leadClassName,
  caret,
  intent,
  grabRef,
  composing,
  embed,
  onToggle,
}: {
  block: Block;
  index: number;
  editable: boolean;
  density: Density;
  placeholder?: string | undefined;
  leadClassName?: string | undefined;
  caret: number | null;
  intent: number;
  grabRef: RefObject<boolean>;
  composing: RefObject<boolean>;
  embed?: ((id: string) => ReactNode) | undefined;
  onToggle: (checked: boolean) => void;
}) {
  if (block.kind === "task")
    return (
      <div data-md-row={index} contentEditable={false}>
        {embed ? embed(block.id) : null}
      </div>
    );
  if (block.kind === "rule")
    return (
      <hr
        data-md-row={index}
        contentEditable={false}
        className="my-1 border-line"
      />
    );
  const indent =
    block.kind === "ul" || block.kind === "ol" || block.kind === "check"
      ? block.indent.length * 0.65
      : 0;
  const marker =
    block.kind === "ul" ? (
      <Mark bullet />
    ) : block.kind === "ol" ? (
      <Mark>{`${block.n}${block.suffix}`}</Mark>
    ) : block.kind === "check" ? (
      <input
        type="checkbox"
        className={cx(
          "mt-1 size-4 shrink-0 accent-[var(--accent)]",
          !editable && "pointer-events-none"
        )}
        checked={block.checked}
        contentEditable={false}
        aria-label={block.checked ? "Hotovo" : "Otevřeno"}
        onMouseDown={(event) => event.preventDefault()}
        onChange={(event) => onToggle(event.target.checked)}
      />
    ) : null;
  const body = (
    <Line
      text={block.text}
      plain={block.kind === "code"}
      caret={caret}
      placeholder={placeholder}
      index={index}
      intent={intent}
      grabRef={grabRef}
      composing={composing}
      editable={editable}
      className={cx(
        index === 0 && block.kind === "p" && leadClassName,
        headingClass(block, density)
      )}
    />
  );
  if (block.kind === "code")
    return (
      <pre data-md-row={index} className="whitespace-pre-wrap">
        {body}
      </pre>
    );
  if (block.kind === "quote")
    return (
      <blockquote data-md-row={index} className="my-0">
        {body}
      </blockquote>
    );
  return (
    <div
      data-md-row={index}
      className={cx(
        marker && "flex gap-2",
        block.kind === "check" && block.checked && "text-muted line-through"
      )}
      style={indent > 0 ? { paddingLeft: `${indent}rem` } : undefined}
    >
      {marker}
      <div className={cx(marker && "min-w-0 flex-1")}>{body}</div>
    </div>
  );
}

function Mark({
  children,
  bullet = false,
}: {
  children?: ReactNode;
  bullet?: boolean;
}) {
  return (
    <span
      aria-hidden
      contentEditable={false}
      className={
        bullet ? "md-bullet" : "mt-0.5 w-5 shrink-0 select-none font-medium"
      }
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </span>
  );
}

function lineBlock(block: Block) {
  return block.kind !== "rule" && block.kind !== "task";
}

function placeholderFor(
  block: Block,
  index: number,
  blocks: Block[],
  placeholder?: string,
  tailPlaceholder?: string
) {
  if (block.kind !== "p" || block.text !== "") return undefined;
  if (index === 0 && blocks.length === 1) return placeholder;
  const previous = blocks[0];
  if (
    tailPlaceholder &&
    blocks.length === 2 &&
    index === 1 &&
    previous &&
    lineBlock(previous) &&
    blockText(previous).trim() !== ""
  )
    return tailPlaceholder;
  return undefined;
}

type CaretPoint = { index: number; caret: number };

function lineNode(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-md-line]") ?? null;
}

function pointIn(
  root: HTMLElement,
  node: Node,
  offset: number
): CaretPoint | null {
  const line = lineNode(node);
  if (line && root.contains(line)) {
    const index = Number(line.dataset.mdLine);
    if (!Number.isFinite(index)) return null;
    return {
      index,
      caret: pointOffset(line, node, offset, line.hasAttribute("data-plain")),
    };
  }
  const el = node instanceof Element ? node : node.parentElement;
  const row = el?.closest<HTMLElement>("[data-md-row]");
  if (!row || !root.contains(row)) return null;
  const index = Number(row.dataset.mdRow);
  if (!Number.isFinite(index)) return null;
  return { index, caret: 0 };
}

function selectionIn(
  root: HTMLElement
): { anchor: CaretPoint; focus: CaretPoint } | null {
  const sel = window.getSelection();
  if (
    !sel ||
    sel.rangeCount === 0 ||
    !sel.anchorNode ||
    !root.contains(sel.anchorNode)
  )
    return null;
  const anchor = pointIn(root, sel.anchorNode, sel.anchorOffset);
  if (!anchor) return null;
  const focus =
    sel.focusNode && root.contains(sel.focusNode)
      ? (pointIn(root, sel.focusNode, sel.focusOffset) ?? anchor)
      : anchor;
  return { anchor, focus };
}

function orderedRange(anchor: CaretPoint, focus: CaretPoint) {
  if (
    anchor.index < focus.index ||
    (anchor.index === focus.index && anchor.caret <= focus.caret)
  )
    return { start: anchor, end: focus };
  return { start: focus, end: anchor };
}

function plainBetween(blocks: Block[], start: CaretPoint, end: CaretPoint) {
  const parts: string[] = [];
  for (let index = start.index; index <= end.index; index += 1) {
    const block = blocks[index];
    if (!block || !lineBlock(block)) continue;
    const text = blockText(block);
    if (index === start.index && index === end.index)
      parts.push(text.slice(start.caret, end.caret));
    else if (index === start.index) parts.push(text.slice(start.caret));
    else if (index === end.index) parts.push(text.slice(0, end.caret));
    else parts.push(text);
  }
  return parts.join("\n");
}

function columnInLine(text: string, caret: number) {
  const start = text.lastIndexOf("\n", Math.max(0, caret - 1));
  return caret - (start < 0 ? 0 : start + 1);
}

function caretOnLine(text: string, column: number, dir: -1 | 1) {
  if (dir < 0) {
    const nl = text.lastIndexOf("\n");
    const start = nl < 0 ? 0 : nl + 1;
    return start + Math.min(column, text.length - start);
  }
  const nl = text.indexOf("\n");
  const end = nl < 0 ? text.length : nl;
  return Math.min(column, end);
}

function atVisualEdge(node: HTMLElement, dir: -1 | 1) {
  const box = node.getBoundingClientRect();
  const line = Number.parseFloat(getComputedStyle(node).lineHeight);
  if (Number.isFinite(line) && box.height <= line * 1.35) return true;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const caret = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (caret.height === 0) return true;
  const slack = Math.max(6, caret.height * 0.65);
  if (dir < 0) return caret.top <= box.top + slack;
  return caret.bottom >= box.bottom - slack;
}

function headingClass(block: Block, density: Density): string | undefined {
  if (block.kind !== "h") return undefined;
  if (density === "inline") return "font-semibold";
  if (block.level <= 1)
    return "font-display text-xl font-semibold leading-tight";
  if (block.level === 2) return "text-lg font-semibold leading-snug";
  if (block.level === 3) return "text-base font-semibold leading-snug";
  return "text-sm font-semibold leading-snug";
}

function Line({
  text,
  plain,
  caret,
  placeholder,
  index,
  intent,
  grabRef,
  composing,
  editable,
  className,
}: {
  text: string;
  plain: boolean;
  caret: number | null;
  placeholder?: string | undefined;
  index: number;
  intent: number;
  grabRef: RefObject<boolean>;
  composing: RefObject<boolean>;
  editable: boolean;
  className?: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const painted = useRef<string | null>(null);
  const placed = useRef(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !editable || composing.current) return;
    if (painted.current !== text || node.childNodes.length === 0) {
      paint(node, text, plain);
      painted.current = text;
    }
    if (caret == null) return;
    const host = node.closest<HTMLElement>(".md-doc");
    if (!host) return;
    if (placed.current === intent) {
      const sel = window.getSelection();
      const selecting =
        Boolean(sel && !sel.isCollapsed && sel.anchorNode && host.contains(sel.anchorNode));
      if (!selecting && document.activeElement === host)
        placeCaret(node, text, caret, plain);
      return;
    }
    placed.current = intent;
    const active = document.activeElement;
    const grab = grabRef.current;
    if (grab) grabRef.current = false;
    const canTake =
      grab ||
      active === host ||
      active === document.body ||
      active == null ||
      (active instanceof Node && host.contains(active));
    if (!canTake) return;
    if (active !== host) host.focus({ preventScroll: true });
    placeCaret(node, text, caret, plain);
  }, [text, caret, plain, editable, intent, composing, grabRef]);
  if (!editable)
    return (
      <div
        data-md-line={index}
        className={cx("md-line whitespace-pre-wrap", className)}
      >
        <InlineView text={text} plain={plain} />
      </div>
    );
  return (
    <div
      ref={ref}
      data-md-line={index}
      {...(plain ? { "data-plain": "" } : {})}
      data-placeholder={placeholder ?? ""}
      className={cx("md-line whitespace-pre-wrap", className)}
    />
  );
}

function InlineView({ text, plain }: { text: string; plain: boolean }) {
  if (plain) return <>{text}</>;
  const runs = parseInline(text);
  if (runs.length === 0) return null;
  return runs.map((run, index) => <Run key={index} run={run} />);
}

function Run({ run }: { run: Inline }) {
  return <>{styledRun(run)}</>;
}

function styledRun(run: Inline): ReactNode {
  let node: ReactNode = run.value;
  if (run.kind === "code") node = <code>{node}</code>;
  if (run.kind === "link" && run.href) node = <RichLink href={run.href}>{node}</RichLink>;
  if (run.kind === "em" || run.em) node = <em>{node}</em>;
  if (run.kind === "strong" || run.strong) node = <strong>{node}</strong>;
  if (run.kind === "strike" || run.strike) node = <s>{node}</s>;
  if (run.underline) node = <u>{node}</u>;
  if (run.color)
    node = (
      <span data-color={run.color} className={`md-c-${run.color}`}>
        {node}
      </span>
    );
  return node;
}

function RichLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith("item:")) {
    const id = href.slice(5);
    return (
      <a
        href={href}
        data-item={id}
        className="md-item"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          document.dispatchEvent(
            new CustomEvent("ordo-open-item", { detail: id })
          );
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noreferrer" } : {})}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}

function paint(root: HTMLElement, source: string, plain: boolean) {
  root.replaceChildren();
  if (source === "") {
    root.dataset.empty = "1";
    root.append(document.createElement("br"));
    return;
  }
  delete root.dataset.empty;
  if (plain) {
    root.append(document.createTextNode(source));
    return;
  }
  for (const run of parseInline(source)) root.append(paintRun(run));
}

function paintRun(run: Inline): Node {
  let node: Node = document.createTextNode(run.value);
  const wrap = (el: HTMLElement) => {
    el.append(node);
    node = el;
  };
  if (run.kind === "code") wrap(document.createElement("code"));
  if (run.kind === "link" && run.href) {
    const link = document.createElement("a");
    link.href = run.href;
    if (run.href.startsWith("item:")) {
      link.dataset.item = run.href.slice(5);
      link.className = "md-item";
    } else if (/^https?:/i.test(run.href)) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    wrap(link);
  }
  if (run.kind === "em" || run.em) wrap(document.createElement("em"));
  if (run.kind === "strong" || run.strong) wrap(document.createElement("strong"));
  if (run.kind === "strike" || run.strike) wrap(document.createElement("s"));
  if (run.underline) wrap(document.createElement("u"));
  if (run.color) {
    const span = document.createElement("span");
    span.dataset.color = run.color;
    span.className = `md-c-${run.color}`;
    wrap(span);
  }
  return node;
}

function readRoot(root: HTMLElement): {
  source: string;
  start: number;
  end: number;
} {
  const plain = root.hasAttribute("data-plain");
  let source = textOf(root, plain);
  if (root.dataset.empty === "1" && (root.textContent ?? "") === "")
    source = "";
  const sel = window.getSelection();
  if (
    !sel ||
    sel.rangeCount === 0 ||
    !sel.anchorNode ||
    !root.contains(sel.anchorNode)
  )
    return { source, start: source.length, end: source.length };
  const start = pointOffset(root, sel.anchorNode, sel.anchorOffset, plain);
  const end =
    sel.focusNode && root.contains(sel.focusNode)
      ? pointOffset(root, sel.focusNode, sel.focusOffset, plain)
      : start;
  return { source, start: Math.min(start, end), end: Math.max(start, end) };
}

function textOf(root: HTMLElement, plain: boolean): string {
  let built = "";
  const walk = (node: Node, top: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      built += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      if (top || root.dataset.empty === "1") return;
      built += "\n";
      return;
    }
    const [open, close] = plain || top ? ["", ""] : marks(node);
    built += open;
    for (const child of node.childNodes) walk(child, false);
    built += close;
  };
  walk(root, true);
  return built;
}

function pointOffset(
  root: HTMLElement,
  target: Node,
  offset: number,
  plain: boolean
): number {
  let built = 0;
  let found: number | null = null;
  const walk = (node: Node, top: boolean) => {
    if (found != null) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (node === target) found = built + Math.min(offset, value.length);
      built += value.length;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      if (node === target) found = built;
      if (!(top || root.dataset.empty === "1")) built += 1;
      return;
    }
    const [open, close] = plain || top ? ["", ""] : marks(node);
    if (node === target) {
      built += open.length;
      const kids = [...node.childNodes];
      for (let i = 0; i < offset && i < kids.length; i += 1)
        walk(kids[i]!, false);
      found = built;
      return;
    }
    built += open.length;
    for (const child of node.childNodes) walk(child, false);
    built += close.length;
  };
  walk(root, true);
  return found ?? built;
}

function marks(node: HTMLElement): [string, string] {
  const tag = node.tagName;
  if (tag === "STRONG" || tag === "B") return ["**", "**"];
  if (tag === "EM" || tag === "I") return ["*", "*"];
  if (tag === "CODE" && node.parentElement?.tagName !== "PRE")
    return ["`", "`"];
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") return ["~~", "~~"];
  if (tag === "U") return ["++", "++"];
  if (tag === "SPAN") {
    const color = node.dataset.color ?? "";
    if (
      color === "red" ||
      color === "green" ||
      color === "blue" ||
      color === "orange" ||
      color === "purple"
    )
      return [`{${color}}`, "{/}"];
  }
  if (tag === "A") {
    const href = node.getAttribute("href") ?? "";
    const text = node.textContent ?? "";
    if (
      !href ||
      href === text ||
      href === `https://${text}` ||
      href.startsWith("tel:") ||
      href.startsWith("mailto:")
    )
      return ["", ""];
    return ["[", `](${href})`];
  }
  return ["", ""];
}

function placeSelection(
  host: HTMLElement,
  blocks: Block[],
  start: CaretPoint,
  end: CaretPoint
) {
  const sel = window.getSelection();
  if (!sel) return;
  const startLine = host.querySelector<HTMLElement>(
    `[data-md-line="${start.index}"]`
  );
  const endLine = host.querySelector<HTMLElement>(
    `[data-md-line="${end.index}"]`
  );
  const startBlock = blocks[start.index];
  const endBlock = blocks[end.index];
  if (!startLine || !endLine) return;
  const startSpot = spotInLine(
    startLine,
    startBlock ? blockText(startBlock) : "",
    start.caret
  );
  const endSpot = spotInLine(
    endLine,
    endBlock ? blockText(endBlock) : "",
    end.caret
  );
  if (!startSpot || !endSpot) return;
  const range = document.createRange();
  try {
    range.setStart(startSpot.node, startSpot.offset);
    range.setEnd(endSpot.node, endSpot.offset);
  } catch {
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function spotInLine(line: HTMLElement, source: string, caret: number) {
  if (line.hasAttribute("data-plain")) return plainSpot(line, caret);
  return richSpot(line, source, caret);
}

function placeCaret(
  root: HTMLElement,
  source: string,
  caret: number,
  plain: boolean
) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const spot = plain ? plainSpot(root, caret) : richSpot(root, source, caret);
  if (!spot) {
    range.setStart(root, 0);
    range.collapse(true);
  } else {
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function plainSpot(
  root: HTMLElement,
  caret: number
): { node: Text; offset: number } | null {
  const text = [...root.childNodes].find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE
  );
  if (!text) return null;
  return { node: text, offset: Math.max(0, Math.min(caret, text.length)) };
}

function richSpot(
  root: HTMLElement,
  source: string,
  caret: number
): { node: Node; offset: number } | null {
  const runs = parseInline(source);
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) nodes.push(node as Text);
    else node.childNodes.forEach(walk);
  };
  walk(root);
  let at = 0;
  for (const run of runs) {
    const node = nodes[at];
    at += 1;
    if (!node) break;
    if (caret <= run.valueFrom) return { node, offset: 0 };
    if (caret < run.valueFrom + run.value.length)
      return { node, offset: Math.max(0, caret - run.valueFrom) };
    if (caret < run.to) return { node, offset: node.length };
  }
  if (root.childNodes.length === 0) return null;
  return { node: root, offset: root.childNodes.length };
}

export function FormatBar({
  onFormat,
  suggest,
}: {
  onFormat: (action: FormatAction) => void;
  suggest?: (query: string) => LinkHit[];
}) {
  const [link, setLink] = useState(false);
  const [href, setHref] = useState("");
  const [pick, setPick] = useState(false);
  const [query, setQuery] = useState("");
  const linkRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (link) linkRef.current?.focus();
  }, [link]);
  useEffect(() => {
    if (pick) pickRef.current?.focus();
  }, [pick]);
  const hold = (event: ReactMouseEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
  };
  const hits = pick && suggest ? suggest(query) : [];
  return (
    <div data-format-bar="" className="grid w-[17rem] gap-1" onMouseDown={hold}>
      <div className="flex flex-wrap items-center gap-0.5">
        <Fmt label="Nadpis 1" onClick={() => onFormat({ type: "heading", level: 1 })}>
          H1
        </Fmt>
        <Fmt label="Nadpis 2" onClick={() => onFormat({ type: "heading", level: 2 })}>
          H2
        </Fmt>
        <Fmt label="Nadpis 3" onClick={() => onFormat({ type: "heading", level: 3 })}>
          H3
        </Fmt>
        <BarGap />
        <Fmt label="Tučné" onClick={() => onFormat({ type: "mark", mark: "strong" })}>
          <b>B</b>
        </Fmt>
        <Fmt label="Kurzíva" onClick={() => onFormat({ type: "mark", mark: "em" })}>
          <i>I</i>
        </Fmt>
        <Fmt
          label="Podtržení"
          onClick={() => onFormat({ type: "mark", mark: "underline" })}
        >
          <u>U</u>
        </Fmt>
        <BarGap />
        <Fmt label="Odrážka" onClick={() => onFormat({ type: "bullet" })}>
          ●
        </Fmt>
        <Fmt label="Zaškrtávací políčko" onClick={() => onFormat({ type: "check" })}>
          ☐
        </Fmt>
        <BarGap />
        <Fmt
          label="Odkaz"
          onClick={() => {
            setPick(false);
            setLink((open) => !open);
          }}
        >
          ↗
        </Fmt>
        {suggest ? (
          <Fmt
            label="Odkaz na úkol nebo poznámku"
            onClick={() => {
              setLink(false);
              setPick((open) => !open);
            }}
          >
            @
          </Fmt>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <Fmt label="Bez barvy" onClick={() => onFormat({ type: "color", color: null })}>
          A
        </Fmt>
        {TEXT_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            aria-label={color.label}
            className="grid size-7 place-items-center rounded-md text-ink!"
            onClick={() => onFormat({ type: "color", color: color.id })}
          >
            <span className={`size-3 rounded-full bg-current md-c-${color.id}`} />
          </button>
        ))}
      </div>
      {link ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onFormat({ type: "link", href });
            setHref("");
            setLink(false);
          }}
        >
          <input
            ref={linkRef}
            value={href}
            onChange={(event) => setHref(event.target.value)}
            placeholder="Adresa odkazu"
            aria-label="Adresa odkazu"
            className="w-full rounded-md bg-black/[0.04] px-2 py-1 text-sm text-ink outline-none"
          />
        </form>
      ) : null}
      {pick && suggest ? (
        <div>
          <input
            ref={pickRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Úkol nebo poznámka"
            aria-label="Úkol nebo poznámka"
            className="w-full rounded-md bg-black/[0.04] px-2 py-1 text-sm text-ink outline-none"
          />
          <div className="mt-1 max-h-40 overflow-auto" role="listbox">
            {hits.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted">Nic tu není.</p>
            ) : (
              hits.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  className="flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left text-sm text-ink!"
                  onClick={() => {
                    onFormat({ type: "item", id: item.id, title: item.title });
                    setQuery("");
                    setPick(false);
                  }}
                >
                  <span className="shrink-0 text-muted">
                    {item.kind === "note" ? "Poznámka" : "Úkol"}
                  </span>
                  <span className="min-w-0 truncate">{item.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Fmt({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid h-7 min-w-7 place-items-center rounded-md px-1 text-xs text-ink!"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BarGap() {
  return <span className="mx-0.5 h-4 w-px bg-line" />;
}
