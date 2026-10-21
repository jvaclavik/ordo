import { fold } from "./text.ts";

export type TextHit = { label: string; start: number; end: number };

const NOT_NAME = new Set([
  "sebou",
  "tim",
  "timhle",
  "timto",
  "tema",
  "nami",
  "vami",
  "detmi",
  "autem",
  "vlakem",
  "busem",
  "kolem",
  "mlekem",
  "chlebem",
  "jidlem",
  "vodou",
  "kavou",
  "pivem",
  "vinem",
  "rodinou",
  "psem",
  "kockou",
  "nakupem",
  "nikym",
  "nekym",
  "cim",
  "kym",
  "prateli",
  "kamarady",
  "balikem",
  "pomoci",
  "kartou",
  "hotovosti",
  "taskou",
  "na",
  "do",
  "ve",
  "od",
  "za",
  "po",
  "pro",
  "pri",
  "bez",
  "pod",
  "nad",
  "ku",
  "ke",
]);

const NAME_STOP = new Set([
  "adresa",
  "adresu",
  "adrese",
  "ulice",
  "ulici",
  "telefon",
  "email",
  "mail",
  "destinace",
  "lokace",
  "patro",
  "zvonek",
  "kancelar",
  "mistnost",
]);

const roomRe =
  /(?<![\p{L}\p{N}])(kanceláře|kanceláři|kanceláří|kancelář|kancelari|kancelare|kancelar|místnosti|místnost|mistnosti|mistnost|bytu|bytě|byte|byt)(?![\p{L}\p{N}])\s+(\d{1,4}(?:\.\d{1,4})?[A-Za-z]?)(?![\p{L}\p{N}])/giu;
const floorRe =
  /(?<![\p{L}\p{N}])(\d{1,2})\.\s*(patro|patře|patra|patru|patre)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(patro|patře|patra|patru|patre)\s+(\d{1,2})(?![\p{L}\p{N}])/giu;
const bellRe =
  /(?<![\p{L}\p{N}])(zvonek|zvonku|zvonkem)(?![\p{L}\p{N}])\s+(\d{1,4}|[\p{L}][\p{L}'’-]{2,})/giu;
const moneyRe =
  /(?<![\p{L}\p{N}])(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:kč|kc|€|eur|,-)(?![\p{L}\p{N}])/giu;
const symbolRe =
  /(?<![\p{L}\p{N}])(?:variabilní symbol|variabilni symbol|var\.?\s*symbol|vs)\s*:?\s*(\d{1,10})(?![\p{L}\p{N}])/giu;
const personCueRe =
  /(?<![\p{L}\p{N}])(kontakt|člověk|clovek|osoba|paní|pani|slečna|slecna|pan|se|s)(?![\p{L}\p{N}])/giu;

export function findSpots(line: string): TextHit[] {
  const hits: TextHit[] = [];
  for (const match of line.matchAll(roomRe)) {
    const start = match.index ?? 0;
    hits.push({
      label: `${roomName(match[1] ?? "")} ${match[2] ?? ""}`,
      start,
      end: start + match[0].length,
    });
  }
  for (const match of line.matchAll(floorRe)) {
    const start = match.index ?? 0;
    const number = match[1] || match[4] || "";
    hits.push({
      label: `${number}. patro`,
      start,
      end: start + match[0].length,
    });
  }
  for (const match of line.matchAll(bellRe)) {
    const token = match[2] ?? "";
    if (!/^\d/.test(token) && blockedName(fold(token))) continue;
    const start = match.index ?? 0;
    const name = /^\d/.test(token) ? token : labelWord(token);
    hits.push({
      label: `Zvonek ${name}`,
      start,
      end: start + match[0].length,
    });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: TextHit[] = [];
  for (const hit of hits) {
    if (kept.some((other) => hit.start < other.end && other.start < hit.end))
      continue;
    kept.push(hit);
  }
  return kept;
}

export function findMoney(line: string): TextHit | null {
  moneyRe.lastIndex = 0;
  const match = moneyRe.exec(line);
  moneyRe.lastIndex = 0;
  if (!match || match.index === undefined) return null;
  return {
    label: moneyLabel(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  };
}

export function findSymbol(
  line: string
): { symbol: string; start: number; end: number } | null {
  symbolRe.lastIndex = 0;
  const match = symbolRe.exec(line);
  symbolRe.lastIndex = 0;
  if (!match || match.index === undefined) return null;
  return {
    symbol: match[1] ?? "",
    start: match.index,
    end: match.index + match[0].length,
  };
}

export function findSpokenPeople(line: string): TextHit[] {
  const hits: TextHit[] = [];
  for (const match of line.matchAll(personCueRe)) {
    const cue = fold(match[1] ?? "");
    const loose = cue !== "s" && cue !== "se";
    const start = match.index ?? 0;
    const read = readName(line, start + match[0].length, loose ? 3 : 2);
    if (!read) continue;
    hits.push({ label: read.name, start, end: read.end });
  }
  hits.sort((a, b) => a.start - b.start);
  const kept: TextHit[] = [];
  for (const hit of hits) {
    if (kept.some((other) => hit.start < other.end && other.start < hit.end))
      continue;
    kept.push(hit);
  }
  return kept;
}

export function storedAmount(value: string | null | undefined): string | null {
  const text = value?.trim().slice(0, 40) ?? "";
  return text || null;
}

export function storedSymbol(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "").slice(0, 10) ?? "";
  return digits || null;
}

function readName(
  line: string,
  cursor: number,
  limit: number
): { name: string; end: number } | null {
  const words: string[] = [];
  let end = cursor;
  while (words.length < limit) {
    const gap = /^\s+/u.exec(line.slice(cursor));
    const at = cursor + (gap?.[0].length ?? 0);
    if (words.length > 0 && !gap) break;
    if (/^\d/u.test(line.slice(at))) break;
    const token = /^[\p{L}][\p{L}'’-]*/u.exec(line.slice(at));
    if (!token || fold(token[0]).length < 2) break;
    const key = fold(token[0]);
    if (blockedName(key) || looksLikeVerb(key)) break;
    const previous = words[0];
    if (previous && startsUpper(previous) && !startsUpper(token[0])) break;
    words.push(token[0]);
    end = at + token[0].length;
    cursor = end;
  }
  if (words.length === 0) return null;
  return { name: words.map(labelWord).join(" "), end };
}

function looksLikeVerb(key: string): boolean {
  return key.length >= 5 && /(?:ovat|nout|it|at|et|yt)$/.test(key);
}

function blockedName(key: string): boolean {
  return NOT_NAME.has(key) || NAME_STOP.has(key) || key.length < 2;
}

function roomName(word: string): string {
  const key = fold(word);
  if (key.startsWith("kancelar")) return "Kancelář";
  if (key.startsWith("mistnost")) return "Místnost";
  return "Byt";
}

function moneyLabel(raw: string): string {
  const euro = /€|eur/i.test(raw);
  const num = raw.match(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}))/);
  const simple = raw.match(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)/);
  const picked = num ?? simple;
  if (!picked) return raw.trim();
  const body = num?.[2]
    ? `${picked[1]!.replace(/[ \u00a0]/g, " ")},${num[2]}`
    : picked[1]!.replace(/[ \u00a0]/g, " ");
  return euro ? `${body} €` : `${body} Kč`;
}

function startsUpper(word: string): boolean {
  const first = word.charAt(0);
  return first !== first.toLocaleLowerCase("cs");
}

function labelWord(word: string): string {
  return word.charAt(0).toLocaleUpperCase("cs") + word.slice(1);
}
