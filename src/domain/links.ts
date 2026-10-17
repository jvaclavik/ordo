const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export type UrlPart =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; href: string };

export function splitUrls(text: string): UrlPart[] {
  const parts: UrlPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    const value = trimUrl(match[0] ?? "");
    if (!value) continue;
    if (index > cursor)
      parts.push({ kind: "text", value: text.slice(cursor, index) });
    parts.push({
      kind: "url",
      value,
      href: /^www\./i.test(value) ? `https://${value}` : value,
    });
    cursor = index + value.length;
  }
  if (cursor < text.length)
    parts.push({ kind: "text", value: text.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: "text", value: text });
  return parts;
}

function trimUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && /[.,;:!?)]/.test(raw[end - 1] ?? "")) {
    if (raw[end - 1] === ")" && raw.slice(0, end).includes("(")) break;
    end -= 1;
  }
  return raw.slice(0, end);
}
