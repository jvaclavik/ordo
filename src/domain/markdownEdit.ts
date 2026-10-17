const listLine =
  /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+\[([ xX])\])?(?:[ \t]+(.*)|[ \t]*)$/;

type ListItem = {
  indent: string;
  bullet: string;
  suffix: string;
  ordered: number | null;
  checkbox: boolean;
  content: string;
};

function parseListItem(line: string): ListItem | null {
  const match = listLine.exec(line);
  if (!match) return null;
  const marker = match[2] ?? "";
  const ordered = /^(\d+)([.)])$/.exec(marker);
  return {
    indent: match[1] ?? "",
    bullet: ordered ? "" : marker,
    suffix: ordered?.[2] ?? "",
    ordered: ordered ? Number(ordered[1]) : null,
    checkbox: match[3] != null,
    content: match[4] ?? "",
  };
}

function markerOf(item: ListItem, fresh: boolean): string {
  if (item.checkbox) return `${item.bullet} [ ] `;
  if (item.ordered != null) {
    const number = fresh ? item.ordered + 1 : item.ordered;
    return `${number}${item.suffix} `;
  }
  return `${item.bullet} `;
}

function outdent(indent: string): string | null {
  if (indent.endsWith("\t")) return indent.slice(0, -1);
  if (indent.length >= 2 && indent.endsWith("  ")) return indent.slice(0, -2);
  if (indent.endsWith(" ")) return indent.slice(0, -1);
  return null;
}

export function continueMarkdownList(
  value: string,
  start: number,
  end: number
): { value: string; cursor: number } | null {
  if (start !== end) {
    value = value.slice(0, start) + value.slice(end);
    end = start;
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", start);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const item = parseListItem(line);
  if (!item) return null;
  const prefixLength = line.length - item.content.length;
  if (start - lineStart < prefixLength) return null;
  if (item.content.trim() === "") {
    const indent = outdent(item.indent);
    if (indent == null) {
      return {
        value: value.slice(0, lineStart) + value.slice(lineEnd),
        cursor: lineStart,
      };
    }
    const nextLine = `${indent}${markerOf(item, false)}`;
    return {
      value: value.slice(0, lineStart) + nextLine + value.slice(lineEnd),
      cursor: lineStart + nextLine.length,
    };
  }
  const insertion = `\n${item.indent}${markerOf(item, true)}`;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    cursor: start + insertion.length,
  };
}
