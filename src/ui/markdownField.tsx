import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  applyBackspace,
  applyEnter,
  applyIndent,
  applyPaste,
  applyText,
  blockText,
  locateCaret,
  parseDocument,
  parseInline,
  serializeDocument,
  sourceCaret,
  type Block,
  type Edit,
  type Inline,
} from "../domain/markdownDoc.ts";
import { cx } from "./ui.tsx";

export type MarkdownHandle = { focus: (caret?: number) => void };

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
    label?: string;
    autoFocus?: boolean;
    className?: string;
    caret?: number | null;
    taskBody?: boolean;
    embed?: (id: string) => ReactNode;
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
    label,
    autoFocus = false,
    className,
    caret = null,
    taskBody = false,
    embed,
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
  const grabRef = useRef(false);
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
          "input, textarea, select, button, a, [contenteditable='true'], [role=listbox]"
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

  useImperativeHandle(ref, () => ({
    focus(caret?: number) {
      const block = docRef.current[0];
      const len = block ? blockText(block).length : 0;
      const at = caret == null ? 0 : Math.max(0, Math.min(caret, len));
      grabRef.current = true;
      setLive({ index: 0, caret: at });
      place();
    },
  }));

  const commit = (edit: Edit) => {
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

  const report = () => {
    const sel = window.getSelection();
    const box = root.current;
    if (!sel || !box || !sel.anchorNode || !box.contains(sel.anchorNode)) {
      selectCb.current?.("");
      return;
    }
    selectCb.current?.(sel.toString());
    const line = (
      sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode
        : sel.anchorNode.parentElement
    )?.closest<HTMLElement>("[data-md-line]");
    if (!line) return;
    const index = Number(line.dataset.mdLine);
    const read = readRoot(line);
    caretCb.current?.(sourceCaret(docRef.current, index, read.start), line);
  };

  return (
    <div
      ref={root}
      className={cx("note-md md-doc grid gap-1", className)}
      {...(taskBody ? { "data-task-body": "" } : {})}
      onMouseUp={editable ? report : undefined}
      onKeyUp={editable ? report : undefined}
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("a")) return;
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
      {doc.map((block, index) => (
        <BlockRow
          key={index}
          block={block}
          index={index}
          editable={editable}
          density={density}
          placeholder={
            placeholder &&
            doc.length === 1 &&
            block.kind === "p" &&
            block.text === ""
              ? placeholder
              : undefined
          }
          label={label}
          caret={live?.index === index ? live.caret : null}
          intent={intent}
          grabRef={grabRef}
          embed={embed}
          onEdit={(text, at) =>
            commit(applyText(docRef.current, index, text, at))
          }
          onEnter={(text, at) => {
            const written = applyText(docRef.current, index, text, at);
            commit(applyEnter(written.blocks, written.index, written.caret));
          }}
          onBackspace={() => {
            const next = applyBackspace(docRef.current, index, 0);
            if (next) commit(next);
          }}
          onTab={(out, at) => {
            const next = applyIndent(docRef.current, index, out, at);
            if (next) commit(next);
            return Boolean(next);
          }}
          onMove={(dir, column) => {
            let to = index + dir;
            while (docRef.current[to] && !lineBlock(docRef.current[to]!))
              to += dir;
            const target = docRef.current[to];
            if (!target) {
              exitRef.current?.(dir, column);
              return;
            }
            grabRef.current = true;
            setLive({
              index: to,
              caret: caretOnLine(blockText(target), column, dir),
            });
            place();
          }}
          onPaste={(text, at, pasted) => {
            const written = applyText(docRef.current, index, text, at);
            commit(
              applyPaste(written.blocks, written.index, written.caret, pasted)
            );
          }}
          onEscape={() => {
            escapeRef.current?.();
            const active = document.activeElement;
            if (active instanceof HTMLElement) active.blur();
          }}
          onToggle={(checked) => {
            if (block.kind !== "check") return;
            const blocks = docRef.current.slice();
            blocks[index] = { ...block, checked };
            commit({ blocks, index, caret: block.text.length });
          }}
        />
      ))}
    </div>
  );
});

function BlockRow({
  block,
  index,
  editable,
  density,
  placeholder,
  label,
  caret,
  intent,
  grabRef,
  embed,
  onEdit,
  onEnter,
  onBackspace,
  onTab,
  onMove,
  onPaste,
  onEscape,
  onToggle,
}: {
  block: Block;
  index: number;
  editable: boolean;
  density: Density;
  placeholder?: string | undefined;
  label?: string | undefined;
  caret: number | null;
  intent: number;
  grabRef: RefObject<boolean>;
  embed?: ((id: string) => ReactNode) | undefined;
  onEdit: (text: string, caret: number) => void;
  onEnter: (text: string, caret: number) => void;
  onBackspace: () => void;
  onTab: (out: boolean, caret: number) => boolean;
  onMove: (dir: -1 | 1, column: number) => void;
  onPaste: (text: string, caret: number, pasted: string) => void;
  onEscape: () => void;
  onToggle: (checked: boolean) => void;
}) {
  if (block.kind === "task") return <div>{embed ? embed(block.id) : null}</div>;
  if (block.kind === "rule") return <hr className="my-1 border-line" />;
  const indent =
    block.kind === "ul" || block.kind === "ol" || block.kind === "check"
      ? block.indent.length * 0.65
      : 0;
  const marker =
    block.kind === "ul" ? (
      <Mark>•</Mark>
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
      label={label}
      index={index}
      intent={intent}
      grabRef={grabRef}
      editable={editable}
      className={headingClass(block, density)}
      onEdit={onEdit}
      onEnter={onEnter}
      onBackspace={onBackspace}
      onTab={onTab}
      onMove={onMove}
      onPaste={onPaste}
      onEscape={onEscape}
    />
  );
  if (block.kind === "code")
    return <pre className="whitespace-pre-wrap">{body}</pre>;
  if (block.kind === "quote")
    return <blockquote className="my-0">{body}</blockquote>;
  return (
    <div
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

function Mark({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      contentEditable={false}
      className="mt-0.5 w-5 shrink-0 select-none text-muted"
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </span>
  );
}

function lineBlock(block: Block) {
  return block.kind !== "rule" && block.kind !== "task";
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
  return "font-semibold leading-snug";
}

function Line({
  text,
  plain,
  caret,
  placeholder,
  label,
  index,
  intent,
  grabRef,
  editable,
  className,
  onEdit,
  onEnter,
  onBackspace,
  onTab,
  onMove,
  onPaste,
  onEscape,
}: {
  text: string;
  plain: boolean;
  caret: number | null;
  placeholder?: string | undefined;
  label?: string | undefined;
  index: number;
  intent: number;
  grabRef: RefObject<boolean>;
  editable: boolean;
  className?: string | undefined;
  onEdit: (text: string, caret: number) => void;
  onEnter: (text: string, caret: number) => void;
  onBackspace: () => void;
  onTab: (out: boolean, caret: number) => boolean;
  onMove: (dir: -1 | 1, column: number) => void;
  onPaste: (text: string, caret: number, pasted: string) => void;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const painted = useRef<string | null>(null);
  const placed = useRef(0);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !editable) return;
    if (painted.current !== text || node.childNodes.length === 0) {
      paint(node, text, plain);
      painted.current = text;
    }
    if (caret == null) return;
    if (placed.current === intent) {
      if (document.activeElement === node) placeCaret(node, text, caret, plain);
      return;
    }
    placed.current = intent;
    const active = document.activeElement;
    const editor = node.closest(".md-doc");
    const grab = grabRef.current;
    if (grab) grabRef.current = false;
    const canTake =
      grab ||
      active === node ||
      active === document.body ||
      active == null ||
      (active instanceof Node && Boolean(editor?.contains(active)));
    if (!canTake) return;
    if (active !== node) node.focus();
    placeCaret(node, text, caret, plain);
  }, [text, caret, plain, editable, intent]);
  if (!editable)
    return (
      <div className={cx("md-line whitespace-pre-wrap", className)}>
        <InlineView text={text} plain={plain} />
      </div>
    );
  const flush = () => {
    const node = ref.current;
    if (!node || composing.current) return;
    const read = readRoot(node);
    onEdit(read.source, read.start);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
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
      const read = readRoot(event.currentTarget);
      onEnter(
        read.source.slice(0, read.start) + read.source.slice(read.end),
        read.start
      );
      return;
    }
    if (
      event.key === "Backspace" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const read = readRoot(event.currentTarget);
      if (read.start === 0 && read.end === 0) {
        event.preventDefault();
        event.stopPropagation();
        onBackspace();
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const read = readRoot(event.currentTarget);
      if (!onTab(event.shiftKey, read.start))
        onMove(event.shiftKey ? -1 : 1, columnInLine(read.source, read.start));
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    const read = readRoot(event.currentTarget);
    if (read.start !== read.end) return;
    const dir = event.key === "ArrowUp" ? -1 : 1;
    if (!atVisualEdge(event.currentTarget, dir)) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(dir, columnInLine(read.source, read.start));
  };
  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-md-line={index}
      {...(plain ? { "data-plain": "" } : {})}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder ?? ""}
      className={cx("md-line whitespace-pre-wrap outline-none", className)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        flush();
      }}
      onInput={flush}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        event.preventDefault();
        const pasted = event.clipboardData.getData("text/plain");
        const read = readRoot(event.currentTarget);
        onPaste(
          read.source.slice(0, read.start) + read.source.slice(read.end),
          read.start,
          pasted
        );
      }}
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
  if (run.kind === "strong") return <strong>{run.value}</strong>;
  if (run.kind === "em") return <em>{run.value}</em>;
  if (run.kind === "code") return <code>{run.value}</code>;
  if (run.kind === "strike") return <s>{run.value}</s>;
  if (run.kind === "link" && run.href)
    return (
      <a
        href={run.href}
        {...(/^https?:/i.test(run.href)
          ? { target: "_blank", rel: "noreferrer" }
          : {})}
        onClick={(event) => event.stopPropagation()}
      >
        {run.value}
      </a>
    );
  return <>{run.value}</>;
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
  for (const run of parseInline(source)) {
    const text = document.createTextNode(run.value);
    if (run.kind === "text") {
      root.append(text);
      continue;
    }
    if (run.kind === "strong") append(root, "strong", text);
    else if (run.kind === "em") append(root, "em", text);
    else if (run.kind === "code") append(root, "code", text);
    else if (run.kind === "strike") append(root, "s", text);
    else if (run.kind === "link" && run.href) {
      const link = document.createElement("a");
      link.href = run.href;
      if (/^https?:/i.test(run.href)) {
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      link.append(text);
      root.append(link);
    }
  }
}

function append(
  root: HTMLElement,
  tag: "strong" | "em" | "code" | "s",
  text: Text
) {
  const node = document.createElement(tag);
  node.append(text);
  root.append(node);
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
): { node: Text; offset: number } | null {
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
    if (caret <= run.valueFrom + run.value.length)
      return { node, offset: Math.max(0, caret - run.valueFrom) };
    if (caret < run.to) return { node, offset: node.length };
  }
  const last = nodes[nodes.length - 1];
  if (!last) return null;
  return { node: last, offset: last.length };
}
