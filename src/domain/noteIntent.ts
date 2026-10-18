import { foldWithMap, originalSpan } from "./text.ts";

const VERB =
  "pridejte|pridej|pridat|pridam|ulozte|ulozit|uloz|zapiste|zapsat|zapis|poznamenejte|poznamenej|potrebuju|potrebuji|vlozte|vlozit|vloz|dejte|dej|chci";
const FILL = "(?:\\s+(?:si|mi|to|tu|tam|jeste|prosim))*";
const EXTRA =
  "(?:\\s+(?:novou|nova|nove|dalsi|mezi|do|po|ke|k)){0,2}";
const NOUN = "poznam(?:kach|kam|kou|ku|ky|ce|ek|ka)";
const PHRASE = `(?:(?:${VERB})${FILL}${EXTRA}\\s+${NOUN}|(?:nova|novou|nove)\\s+${NOUN}|${NOUN}\\s*[:\\-–—])(?:\\s*[:\\-–—.,])?`;
const COMMAND = new RegExp(`(?<![a-z0-9])${PHRASE}(?![a-z0-9])`, "u");

export function takeNoteIntent(source: string): { note: boolean; text: string } {
  const trimmed = source.trim();
  if (!trimmed) return { note: false, text: source };
  const mapped = foldWithMap(trimmed);
  const match = COMMAND.exec(mapped.text);
  if (!match || match.index === undefined) return { note: false, text: source };
  const span = originalSpan(
    trimmed,
    mapped.starts,
    match.index,
    match.index + match[0].length
  );
  return { note: true, text: remainder(trimmed, span.start, span.end) };
}

export function splitNoteDraft(text: string) {
  const source = text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!source) return null;
  const first = source.split("\n", 1)[0] ?? source;
  const title = first
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim()
    .slice(0, 500);
  if (!title) return null;
  return { title, body: source };
}

function remainder(source: string, start: number, end: number) {
  const beforeRaw = source.slice(0, start);
  const afterRaw = source.slice(end);
  const before = beforeRaw.replace(/[ \t:.,\-–—]*$/u, "").replace(/\n+$/u, "");
  const after = afterRaw.replace(/^[ \t:.,\-–—]+/u, "").replace(/^\n+/u, "");
  if (!before.trim()) return after.trim();
  if (!after.trim()) return before.trim();
  const sameLine = !beforeRaw.includes("\n") && !/^\s*\n/.test(afterRaw);
  return sameLine
    ? `${before.trim()} ${after.trim()}`
    : `${before.trim()}\n${after.trim()}`;
}
