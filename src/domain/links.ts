const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const phonePattern =
  /(?<![\p{L}\p{N}])((?:\+|00)?(?:420[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3})(?![\p{L}\p{N}])/gu;
const emailPattern =
  /(?<![\p{L}\p{N}])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![\p{L}\p{N}])/gu;

export type TextPart =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string; href: string }
  | { kind: "phone"; value: string; href: string }
  | { kind: "email"; value: string; href: string };

export type UrlPart = Extract<TextPart, { kind: "text" | "url" }>;

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

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  for (const part of splitUrls(text)) {
    if (part.kind === "url") parts.push(part);
    else parts.push(...splitMentions(part.value));
  }
  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

export function phonesIn(text: string): { value: string; href: string }[] {
  return splitLinks(text).flatMap((part) =>
    part.kind === "phone" ? [{ value: part.value, href: part.href }] : []
  );
}

export function emailsIn(text: string): { value: string; href: string }[] {
  return splitLinks(text).flatMap((part) =>
    part.kind === "email" ? [{ value: part.value, href: part.href }] : []
  );
}

export function smsHref(raw: string): string | null {
  const tel = phoneHref(raw);
  return tel ? `sms:${tel.slice("tel:".length)}` : null;
}

export function whatsAppHref(raw: string): string | null {
  const tel = phoneHref(raw);
  if (!tel) return null;
  return `https://wa.me/${tel.slice("tel:+".length)}`;
}

export function linkPhones(text: string): string {
  return text
    .split(/(\[[^\]]*\]\([^)]*\)|`[^`]*`)/g)
    .map((part, index) =>
      index % 2 === 1 ? part : linkPhonesOutsideUrls(part)
    )
    .join("");
}

function linkPhonesOutsideUrls(text: string): string {
  return splitUrls(text)
    .map((part) =>
      part.kind === "url"
        ? part.value
        : splitMentions(part.value)
            .map((bit) =>
              bit.kind === "phone" || bit.kind === "email"
                ? `[${bit.value}](${bit.href})`
                : bit.value
            )
            .join("")
    )
    .join("");
}

function splitMentions(text: string): TextPart[] {
  const parts: TextPart[] = [];
  for (const part of splitEmails(text)) {
    if (part.kind === "email") parts.push(part);
    else parts.push(...splitPhones(part.value));
  }
  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

function splitEmails(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(emailPattern)) {
    const index = match.index ?? 0;
    const value = match[1] ?? "";
    if (!value) continue;
    if (index > cursor)
      parts.push({ kind: "text", value: text.slice(cursor, index) });
    parts.push({ kind: "email", value, href: `mailto:${value}` });
    cursor = index + value.length;
  }
  if (cursor < text.length)
    parts.push({ kind: "text", value: text.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: "text", value: text });
  return parts;
}

function splitPhones(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(phonePattern)) {
    const index = match.index ?? 0;
    const value = match[1] ?? "";
    const href = phoneHref(value);
    if (!href || isVariableSymbol(text, index)) {
      if (href && isVariableSymbol(text, index)) {
        parts.push({
          kind: "text",
          value: text.slice(cursor, index + value.length),
        });
        cursor = index + value.length;
      }
      continue;
    }
    if (index > cursor)
      parts.push({ kind: "text", value: text.slice(cursor, index) });
    parts.push({ kind: "phone", value, href });
    cursor = index + value.length;
  }
  if (cursor < text.length)
    parts.push({ kind: "text", value: text.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: "text", value: text });
  return parts;
}

export function phoneHref(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  if (raw.trim().startsWith("+")) return `tel:+${digits}`;
  if (digits.startsWith("00") && digits.length >= 11)
    return `tel:+${digits.slice(2)}`;
  if (digits.length === 12 && digits.startsWith("420")) return `tel:+${digits}`;
  if (digits.length === 9) return `tel:+420${digits}`;
  if (digits.length === 10 && digits.startsWith("0"))
    return `tel:+420${digits.slice(1)}`;
  return `tel:+${digits}`;
}

function isVariableSymbol(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  return /(?:variabiln[ií] symbol|var\.?\s*symbol|(?<![\p{L}\p{N}])vs)\s*:?\s*$/iu.test(
    before
  );
}

function trimUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && /[.,;:!?)]/.test(raw[end - 1] ?? "")) {
    if (raw[end - 1] === ")" && raw.slice(0, end).includes("(")) break;
    end -= 1;
  }
  return raw.slice(0, end);
}
