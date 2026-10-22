import { splitLinks } from "./links.ts";

export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Bullet = "-" | "*" | "+";
export type Suffix = "." | ")";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: Level; text: string }
  | { kind: "quote"; text: string }
  | { kind: "ul"; indent: string; marker: Bullet; text: string }
  | { kind: "ol"; indent: string; n: number; suffix: Suffix; text: string }
  | {
      kind: "check";
      indent: string;
      marker: Bullet;
      checked: boolean;
      text: string;
    }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" }
  | { kind: "task"; id: string };

export type Inline = {
  kind: "text" | "strong" | "em" | "code" | "strike" | "link";
  value: string;
  href?: string;
  from: number;
  to: number;
  valueFrom: number;
};

export type Edit = { blocks: Block[]; index: number; caret: number };

const TASK_LINE = /^\s*\{\{task:([A-Za-z0-9_-]+)\}\}\s*$/;
const FENCE = /^(```|~~~)(.*)$/;
const FENCE_CLOSE = /^(```|~~~)\s*$/;

function levelOf(n: number): Level {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  if (n === 5) return 5;
  return 6;
}

function bulletOf(value: string): Bullet {
  if (value === "*" || value === "+") return value;
  return "-";
}

function suffixOf(value: string): Suffix {
  return value === ")" ? ")" : ".";
}

export function parseDocument(source: string): Block[] {
  const text = source.replace(/\r\n/g, "\n");
  if (text === "") return [{ kind: "p", text: "" }];
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = (fence[2] ?? "").trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }
    const task = TASK_LINE.exec(line);
    if (task?.[1]) {
      blocks.push({ kind: "task", id: task[1] });
      i += 1;
      continue;
    }
    if (/^ {0,3}(\*\*\*|---|___)\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading?.[1]) {
      blocks.push({
        kind: "h",
        level: levelOf(heading[1].length),
        text: heading[2] ?? "",
      });
      i += 1;
      continue;
    }
    const quote = /^>[ \t]?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ kind: "quote", text: quote[1] ?? "" });
      i += 1;
      continue;
    }
    const check = /^([ \t]*)([-*+])[ \t]+\[([ xX])\][ \t]*(.*)$/.exec(line);
    if (check) {
      blocks.push({
        kind: "check",
        indent: check[1] ?? "",
        marker: bulletOf(check[2] ?? "-"),
        checked: (check[3] ?? " ") !== " ",
        text: check[4] ?? "",
      });
      i += 1;
      continue;
    }
    const ordered = /^([ \t]*)(\d+)([.)])[ \t]+(.*)$/.exec(line);
    if (ordered?.[2] && ordered[3]) {
      blocks.push({
        kind: "ol",
        indent: ordered[1] ?? "",
        n: Number(ordered[2]),
        suffix: suffixOf(ordered[3]),
        text: ordered[4] ?? "",
      });
      i += 1;
      continue;
    }
    const list = /^([ \t]*)([-*+])[ \t]+(.*)$/.exec(line);
    if (list) {
      blocks.push({
        kind: "ul",
        indent: list[1] ?? "",
        marker: bulletOf(list[2] ?? "-"),
        text: list[3] ?? "",
      });
      i += 1;
      continue;
    }
    blocks.push({ kind: "p", text: line });
    i += 1;
  }
  return blocks.length > 0 ? blocks : [{ kind: "p", text: "" }];
}

export function blockText(block: Block): string {
  if (block.kind === "rule" || block.kind === "task") return "";
  return block.text;
}

export function blockSource(block: Block): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "h":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "quote":
      return `> ${block.text}`;
    case "ul":
      return `${block.indent}${block.marker} ${block.text}`;
    case "ol":
      return `${block.indent}${block.n}${block.suffix} ${block.text}`;
    case "check":
      return `${block.indent}${block.marker} [${block.checked ? "x" : " "}] ${block.text}`;
    case "code":
      return "```" + block.lang + "\n" + block.text + "\n```";
    case "rule":
      return "---";
    case "task":
      return `{{task:${block.id}}}`;
  }
}

export function serializeDocument(blocks: Block[]): string {
  if (blocks.length === 1 && blocks[0]?.kind === "p" && blocks[0].text === "")
    return "";
  return blocks.map(blockSource).join("\n");
}

export function contentPrefix(block: Block): number {
  if (block.kind === "code") return ("```" + block.lang + "\n").length;
  if (block.kind === "rule" || block.kind === "task") return blockSource(block).length;
  return blockSource(block).length - block.text.length;
}

export function sourceCaret(blocks: Block[], index: number, caret: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += blockSource(blocks[i]!).length + 1;
  const block = blocks[index];
  if (!block) return offset;
  return offset + contentPrefix(block) + caret;
}

export function locateCaret(
  blocks: Block[],
  source: number
): { index: number; caret: number } {
  let offset = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const size = blockSource(block).length;
    if (source <= offset + size || i === blocks.length - 1) {
      const within = Math.min(Math.max(0, source - offset), size);
      const prefix = contentPrefix(block);
      const caret = Math.max(0, Math.min(blockText(block).length, within - prefix));
      return { index: i, caret };
    }
    offset += size + 1;
  }
  return { index: 0, caret: 0 };
}

function replace(blocks: Block[], index: number, block: Block, caret: number): Edit {
  const next = blocks.slice();
  next[index] = block;
  return { blocks: next, index, caret };
}

function withText(block: Block, text: string): Block {
  if (block.kind === "rule" || block.kind === "task") return block;
  return { ...block, text };
}

function turned(head: string, tail: string): { block: Block; caret: number } | null {
  if ((head === "---" || head === "***" || head === "___") && tail === "")
    return { block: { kind: "rule" }, caret: 0 };
  if (head === "```")
    return { block: { kind: "code", lang: "", text: tail }, caret: 0 };
  const heading = /^(#{1,6}) $/.exec(head);
  if (heading?.[1])
    return {
      block: { kind: "h", level: levelOf(heading[1].length), text: tail },
      caret: 0,
    };
  if (head === "> ") return { block: { kind: "quote", text: tail }, caret: 0 };
  if (head === "[] ")
    return {
      block: { kind: "check", indent: "", marker: "-", checked: false, text: tail },
      caret: 0,
    };
  const ordered = /^(\d+)([.)]) $/.exec(head);
  if (ordered?.[1] && ordered[2])
    return {
      block: {
        kind: "ol",
        indent: "",
        n: Number(ordered[1]),
        suffix: suffixOf(ordered[2]),
        text: tail,
      },
      caret: 0,
    };
  const list = /^([-*+]) $/.exec(head);
  if (list?.[1])
    return {
      block: { kind: "ul", indent: "", marker: bulletOf(list[1]), text: tail },
      caret: 0,
    };
  return null;
}

export function applyText(
  blocks: Block[],
  index: number,
  text: string,
  caret: number
): Edit {
  const block = blocks[index];
  if (!block) return { blocks, index, caret };
  if (block.kind === "code") return replace(blocks, index, { ...block, text }, caret);
  if (block.kind === "rule" || block.kind === "task") return { blocks, index, caret };
  const head = text.slice(0, caret);
  const tail = text.slice(caret);
  if (block.kind === "p" || block.kind === "h" || block.kind === "quote") {
    const next = turned(head, tail);
    if (next) {
      if (next.block.kind === "rule") {
        const copy = blocks.slice();
        copy.splice(index, 1, next.block, { kind: "p", text: "" });
        return { blocks: copy, index: index + 1, caret: 0 };
      }
      return replace(blocks, index, next.block, next.caret);
    }
  }
  if ((block.kind === "p" || block.kind === "ul") && head === "[] ") {
    return replace(
      blocks,
      index,
      {
        kind: "check",
        indent: block.kind === "ul" ? block.indent : "",
        marker: block.kind === "ul" ? block.marker : "-",
        checked: false,
        text: tail,
      },
      0
    );
  }
  if (block.kind === "p" && caret === text.length) {
    const parsed = parseDocument(text);
    const only = parsed.length === 1 ? parsed[0] : null;
    if (only && only.kind !== "p") return replace(blocks, index, only, blockText(only).length);
  }
  return replace(blocks, index, withText(block, text), caret);
}

function outdent(indent: string): string {
  if (indent.endsWith("\t")) return indent.slice(0, -1);
  if (indent.endsWith("  ")) return indent.slice(0, -2);
  if (indent.endsWith(" ")) return indent.slice(0, -1);
  return "";
}

function follow(block: Block, text: string): Block {
  if (block.kind === "ul" || block.kind === "quote") return { ...block, text };
  if (block.kind === "check") return { ...block, checked: false, text };
  if (block.kind === "ol") return { ...block, n: block.n + 1, text };
  return { kind: "p", text };
}

function listLike(block: Block): block is Extract<Block, { kind: "ul" | "ol" | "check" | "quote" }> {
  return (
    block.kind === "ul" ||
    block.kind === "ol" ||
    block.kind === "check" ||
    block.kind === "quote"
  );
}

export function applyEnter(
  blocks: Block[],
  index: number,
  caret: number
): Edit {
  const block = blocks[index];
  if (!block) return { blocks, index, caret };
  if (block.kind === "rule" || block.kind === "task") {
    const copy = blocks.slice();
    copy.splice(index + 1, 0, { kind: "p", text: "" });
    return { blocks: copy, index: index + 1, caret: 0 };
  }
  if (block.kind === "code") {
    const text = block.text.slice(0, caret) + "\n" + block.text.slice(caret);
    return replace(blocks, index, { ...block, text }, caret + 1);
  }
  const before = block.text.slice(0, caret);
  const after = block.text.slice(caret);
  if (listLike(block) && before.trim() === "" && after === "") {
    if ("indent" in block && block.indent.length > 0)
      return replace(blocks, index, { ...block, indent: outdent(block.indent) }, 0);
    return replace(blocks, index, { kind: "p", text: "" }, 0);
  }
  const copy = blocks.slice();
  copy.splice(index, 1, withText(block, before), follow(block, after));
  return { blocks: copy, index: index + 1, caret: 0 };
}

export function applyBackspace(
  blocks: Block[],
  index: number,
  caret: number
): Edit | null {
  if (caret !== 0) return null;
  const block = blocks[index];
  if (!block) return null;
  if (block.kind === "code") {
    if (block.text !== "") return null;
    return replace(blocks, index, { kind: "p", text: "" }, 0);
  }
  if (
    (block.kind === "ul" || block.kind === "ol" || block.kind === "check") &&
    block.indent.length > 0
  )
    return replace(blocks, index, { ...block, indent: outdent(block.indent) }, 0);
  if (block.kind !== "p")
    return replace(blocks, index, { kind: "p", text: blockText(block) }, 0);
  if (index === 0) return null;
  const prev = blocks[index - 1];
  if (!prev) return null;
  if (prev.kind === "rule" || prev.kind === "task") {
    if (block.text !== "") return null;
    const copy = blocks.filter((_, at) => at !== index);
    return {
      blocks: copy.length > 0 ? copy : [{ kind: "p", text: "" }],
      index: index - 1,
      caret: 0,
    };
  }
  const at = prev.kind === "code" ? prev.text.length : blockText(prev).length;
  const merged =
    prev.kind === "code"
      ? { ...prev, text: prev.text + block.text }
      : withText(prev, blockText(prev) + block.text);
  const copy = [...blocks.slice(0, index - 1), merged, ...blocks.slice(index + 1)];
  return { blocks: copy, index: index - 1, caret: at };
}

export function applyIndent(blocks: Block[], index: number, out: boolean, caret: number): Edit | null {
  const block = blocks[index];
  if (!block || (block.kind !== "ul" && block.kind !== "ol" && block.kind !== "check"))
    return null;
  if (out) {
    if (block.indent.length === 0)
      return replace(blocks, index, { kind: "p", text: block.text }, caret);
    return replace(blocks, index, { ...block, indent: outdent(block.indent) }, caret);
  }
  return replace(blocks, index, { ...block, indent: `${block.indent}  ` }, caret);
}

function splice(text: string, caret: number, insert: string) {
  return text.slice(0, caret) + insert + text.slice(caret);
}

export function applyPaste(
  blocks: Block[],
  index: number,
  caret: number,
  pasted: string
): Edit {
  const clean = pasted.replace(/\r\n/g, "\n");
  const block = blocks[index];
  if (!block || block.kind === "rule" || block.kind === "task") {
    const inserted = parseDocument(clean);
    const copy = blocks.slice();
    copy.splice(index + 1, 0, ...inserted);
    const last = inserted[inserted.length - 1];
    return {
      blocks: copy,
      index: index + inserted.length,
      caret: last ? blockText(last).length : 0,
    };
  }
  if (block.kind === "code" || !clean.includes("\n"))
    return applyText(blocks, index, splice(block.text, caret, clean), caret + clean.length);
  if (block.kind === "p") {
    const merged = splice(block.text, caret, clean);
    const parsed = parseDocument(merged);
    const copy = [...blocks.slice(0, index), ...parsed, ...blocks.slice(index + 1)];
    const loc = locateCaret(parsed, Math.min(caret + clean.length, merged.length));
    return { blocks: copy, index: index + loc.index, caret: loc.caret };
  }
  const merged = splice(block.text, caret, clean);
  const lines = merged.split("\n");
  const first = lines[0] ?? "";
  const rest = parseDocument(lines.slice(1).join("\n"));
  const copy = [
    ...blocks.slice(0, index),
    withText(block, first),
    ...rest,
    ...blocks.slice(index + 1),
  ];
  const end = caret + clean.length;
  if (end <= first.length) return { blocks: copy, index, caret: end };
  const loc = locateCaret(rest, end - first.length - 1);
  return { blocks: copy, index: index + 1 + loc.index, caret: loc.caret };
}

function pushText(out: Inline[], value: string, from: number) {
  if (!value) return;
  let cursor = from;
  for (const part of splitLinks(value)) {
    if (part.kind === "text") {
      if (part.value)
        out.push({
          kind: "text",
          value: part.value,
          from: cursor,
          to: cursor + part.value.length,
          valueFrom: cursor,
        });
    } else {
      out.push({
        kind: "link",
        value: part.value,
        href: part.href,
        from: cursor,
        to: cursor + part.value.length,
        valueFrom: cursor,
      });
    }
    cursor += part.value.length;
  }
}

function wrapped(
  kind: "strong" | "em" | "code" | "strike",
  from: number,
  open: number,
  value: string
): Inline {
  return {
    kind,
    value,
    from,
    to: from + open + value.length + open,
    valueFrom: from + open,
  };
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("`", i)) {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1 && !source.slice(i + 1, end).includes("\n")) {
        out.push(wrapped("code", i, 1, source.slice(i + 1, end)));
        i = end + 1;
        continue;
      }
    }
    if (source.startsWith("**", i) || source.startsWith("__", i)) {
      const marker = source.slice(i, i + 2);
      const end = source.indexOf(marker, i + 2);
      if (end > i + 2 && !source.slice(i + 2, end).includes("\n")) {
        out.push(wrapped("strong", i, 2, source.slice(i + 2, end)));
        i = end + 2;
        continue;
      }
    }
    if (source.startsWith("~~", i)) {
      const end = source.indexOf("~~", i + 2);
      if (end > i + 2 && !source.slice(i + 2, end).includes("\n")) {
        out.push(wrapped("strike", i, 2, source.slice(i + 2, end)));
        i = end + 2;
        continue;
      }
    }
    const marker = source[i];
    if ((marker === "*" || marker === "_") && source[i + 1] !== marker) {
      const closer = closingEm(source, i, marker);
      if (closer > i + 1) {
        out.push(wrapped("em", i, 1, source.slice(i + 1, closer)));
        i = closer + 1;
        continue;
      }
    }
    if (marker === "[") {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(source.slice(i));
      if (link?.[1] && link[2]) {
        out.push({
          kind: "link",
          value: link[1],
          href: link[2],
          from: i,
          to: i + link[0].length,
          valueFrom: i + 1,
        });
        i += link[0].length;
        continue;
      }
    }
    let j = i + 1;
    while (j < source.length && !specialAt(source, j)) j += 1;
    pushText(out, source.slice(i, j), i);
    i = j;
  }
  return out;
}

function specialAt(source: string, index: number): boolean {
  const char = source[index];
  return char === "*" || char === "_" || char === "`" || char === "~" || char === "[";
}

function closingEm(source: string, index: number, marker: string): number {
  if (source[index + 1] === " " || source[index + 1] === "\n") return -1;
  if (marker === "_" && index > 0 && /[\p{L}\p{N}]/u.test(source[index - 1] ?? ""))
    return -1;
  for (let at = index + 1; at < source.length; at += 1) {
    if (source[at] === "\n") return -1;
    if (source[at] !== marker || source[at - 1] === " ") continue;
    if (marker === "_" && /[\p{L}\p{N}]/u.test(source[at + 1] ?? "")) continue;
    return at;
  }
  return -1;
}
