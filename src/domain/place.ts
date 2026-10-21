import { fold } from "./text.ts";

const SKIP = new Set([
  "dnes",
  "dneska",
  "zitra",
  "zejtra",
  "pozitri",
  "pondeli",
  "utery",
  "streda",
  "ctvrtek",
  "patek",
  "sobota",
  "nedele",
  "po",
  "ut",
  "st",
  "ct",
  "pa",
  "so",
  "ne",
  "vikend",
  "tyden",
  "tydne",
  "tydnu",
  "pristi",
  "tento",
  "tenhle",
  "jaro",
  "jare",
  "jara",
  "leto",
  "lete",
  "leta",
  "podzim",
  "podzimu",
  "zima",
  "zime",
  "zimu",
  "zimy",
  "rano",
  "vecer",
  "odpoledne",
  "poledne",
  "hodinu",
  "hodiny",
  "hodin",
  "den",
  "dne",
  "dni",
  "dny",
  "tydny",
  "mesic",
  "mesice",
  "mesici",
  "mesicu",
  "rok",
  "roka",
  "roku",
  "roky",
  "let",
  "jeden",
  "jedna",
  "jednoho",
  "jednom",
  "jednu",
  "dva",
  "dve",
  "dvou",
  "dvema",
  "tri",
  "trech",
  "ctyri",
  "ctyr",
  "ctyrech",
  "pet",
  "peti",
  "sest",
  "sesti",
  "sedm",
  "sedmi",
  "osm",
  "osmi",
  "devet",
  "deviti",
  "deset",
  "deseti",
  "slozka",
  "slozky",
  "slozku",
  "slozce",
  "kategorie",
  "kategorii",
  "snidani",
  "obed",
  "obeda",
  "obedu",
  "vecere",
  "veceri",
  "nakup",
  "nakupy",
  "prochazku",
  "prochazce",
  "schuzka",
  "schuzku",
  "schuzce",
  "chvili",
  "chvilku",
  "zkousku",
  "dovolena",
  "dovolene",
  "dovolenou",
  "mobil",
  "web",
  "internet",
  "zoom",
  "email",
  "mail",
  "telefon",
  "cislo",
  "ukol",
  "poznamku",
  "zpravu",
  "sms",
  "odkaz",
  "patro",
  "patre",
  "patra",
  "patru",
  "kancelar",
  "kancelari",
  "mistnost",
  "mistnosti",
  "zvonek",
  "zvonku",
  "byt",
  "bytu",
  "byte",
  "kontakt",
  "clovek",
  "osoba",
  "to",
  "toho",
  "tom",
  "tomu",
  "neco",
  "me",
  "tebe",
  "nas",
  "vas",
  "sebe",
  "neho",
  "nemu",
  "nich",
  "nim",
  "s",
  "se",
  "a",
  "i",
  "nebo",
  "ale",
  "uz",
  "pak",
  "jeste",
  "taky",
  "take",
  "tam",
  "tady",
  "tu",
  "sem",
  "na",
  "do",
  "ve",
  "v",
  "ke",
  "k",
  "u",
  "od",
  "ze",
  "z",
  "pro",
  "po",
  "pred",
  "za",
  "nad",
  "pod",
  "mezi",
]);

const TASK = new Set([
  "zavolat",
  "zavolej",
  "volat",
  "volej",
  "koupit",
  "kup",
  "najit",
  "najdi",
  "vyzvednout",
  "vyzvedni",
  "napsat",
  "napis",
  "poslat",
  "posli",
  "objednat",
  "rezervovat",
  "sehnat",
  "sezen",
  "prinest",
  "prines",
  "uvarit",
  "zalit",
  "vynest",
  "ozvat",
  "ozvi",
  "domluvit",
  "domluv",
  "zajet",
  "zajdi",
  "dojet",
  "prijet",
  "prijed",
  "stavit",
  "stav",
  "zajit",
]);

const STREET = new Set([
  "na",
  "ve",
  "v",
  "ke",
  "k",
  "u",
  "nad",
  "pod",
  "pred",
  "za",
  "mezi",
  "po",
]);

const prepRe = /(?<![\p{L}\p{N}])(na|do|ve|ke|v|k|u)(?![\p{L}\p{N}])/giu;
const cueRe =
  /(?<![\p{L}\p{N}])(na adrese|na adresu|na ulici|adresa|adresu|destinace|lokace|ulice|ulici)(?![\p{L}\p{N}])\s*:?\s*/giu;

export type PlaceHit = { name: string; start: number; end: number };

type Piece = { text: string; end: number; kind: "word" | "number" | "comma" };

export function findPlace(line: string): PlaceHit | null {
  const hits: PlaceHit[] = [];
  for (const match of line.matchAll(prepRe)) {
    const start = match.index ?? 0;
    const pieces = readPieces(line, start + match[0].length, false);
    const hit = hitFrom(pieces, start);
    if (hit) hits.push(hit);
  }
  for (const match of line.matchAll(cueRe)) {
    const start = match.index ?? 0;
    const pieces = readPieces(line, start + match[0].length, true);
    const hit = hitFrom(pieces, start);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  let chosen: PlaceHit | null = null;
  for (const hit of hits) {
    if (chosen && hit.start < chosen.end) {
      if (hit.end - hit.start > chosen.end - chosen.start) chosen = hit;
      continue;
    }
    chosen = hit;
  }
  return chosen;
}

const originRe = /(?<![\p{L}\p{N}])(ze|z)(?![\p{L}\p{N}])/giu;

export function findOrigin(
  line: string,
  destination: PlaceHit | null
): PlaceHit | null {
  if (!destination) return null;
  let best: PlaceHit | null = null;
  for (const match of line.matchAll(originRe)) {
    const start = match.index ?? 0;
    if (start >= destination.start) continue;
    const pieces = readPieces(line, start + match[0].length, true);
    const hit = hitFrom(pieces, start);
    if (!hit || hit.end > destination.start) continue;
    best = hit;
  }
  return best;
}

export function routeHref(
  destination: string,
  origin?: string | null
): string {
  const from = origin
    ? `&origin=${encodeURIComponent(origin)}`
    : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${from}`;
}

export function mapHref(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    place
  )}`;
}

export function storedPlace(value: string | null | undefined): string | null {
  const text = value?.trim().slice(0, 120) ?? "";
  return text || null;
}

function readPieces(line: string, cursor: number, address: boolean): Piece[] {
  const pieces: Piece[] = [];
  let words = 0;
  let numbers = 0;
  let afterComma = false;
  const wordLimit = address ? 6 : 3;
  while (pieces.length < 12) {
    if (pieces.length > 0 && line[cursor] === ",") {
      pieces.push({ text: ",", end: cursor + 1, kind: "comma" });
      cursor += 1;
      afterComma = true;
      numbers = 0;
      continue;
    }
    const gap = /^\s+/u.exec(line.slice(cursor));
    if (pieces.length > 0 && !gap && !afterComma) break;
    const at = cursor + (gap?.[0].length ?? 0);
    afterComma = false;
    const number = /^\d{1,5}(?:\/\d{1,4}|[A-Za-z])?(?![\p{L}\p{N}])/u.exec(
      line.slice(at)
    );
    if (number && words > 0 && numbers < 3) {
      pieces.push({
        text: number[0],
        end: at + number[0].length,
        kind: "number",
      });
      numbers += 1;
      cursor = at + number[0].length;
      continue;
    }
    if (words >= wordLimit) break;
    const token = /^[\p{L}][\p{L}'’-]*/u.exec(line.slice(at));
    if (!token || fold(token[0]).length < 2) break;
    const key = fold(token[0]);
    if ((SKIP.has(key) && !(address && STREET.has(key))) || TASK.has(key))
      break;
    const firstWord = pieces.find((piece) => piece.kind === "word");
    if (
      !address &&
      firstWord &&
      startsUpper(firstWord.text) &&
      !startsUpper(token[0])
    )
      break;
    pieces.push({ text: token[0], end: at + token[0].length, kind: "word" });
    words += 1;
    numbers = 0;
    cursor = at + token[0].length;
  }
  while (pieces.at(-1)?.kind === "comma") pieces.pop();
  return pieces;
}

function hitFrom(pieces: Piece[], start: number): PlaceHit | null {
  if (!pieces.some((piece) => piece.kind === "word")) return null;
  const last = pieces.at(-1);
  if (!last) return null;
  return { name: placeName(pieces), start, end: last.end };
}

function placeName(pieces: Piece[]): string {
  let name = "";
  for (const piece of pieces) {
    if (piece.kind === "comma") {
      name = name.replace(/\s+$/u, "") + ", ";
      continue;
    }
    const text = piece.kind === "word" ? labelWord(piece.text) : piece.text;
    name += name.endsWith(" ") || name === "" ? text : ` ${text}`;
  }
  return name.trim();
}

function labelWord(word: string): string {
  return word.charAt(0).toLocaleUpperCase("cs") + word.slice(1);
}

function startsUpper(word: string): boolean {
  const first = word.charAt(0);
  return first !== first.toLocaleLowerCase("cs");
}
