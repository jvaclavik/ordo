export type ClockHit = { start: number; end: number; time: string };

const HOUR_WORDS: Record<string, number> = {
  jedna: 1,
  jednu: 1,
  jedne: 1,
  jednou: 1,
  dve: 2,
  dva: 2,
  dvou: 2,
  tri: 3,
  trech: 3,
  ctyri: 4,
  ctyrech: 4,
  pet: 5,
  peti: 5,
  sest: 6,
  sesti: 6,
  sedm: 7,
  sedmi: 7,
  osm: 8,
  osmi: 8,
  devet: 9,
  deviti: 9,
  deset: 10,
  deseti: 10,
  jedenact: 11,
  jedenacti: 11,
  dvanact: 12,
  dvanacti: 12,
  trinact: 13,
  trinacti: 13,
  ctrnact: 14,
  ctrnacti: 14,
  patnact: 15,
  patnacti: 15,
  sestnact: 16,
  sestnacti: 16,
  sedmnact: 17,
  sedmnacti: 17,
  osmnact: 18,
  osmnacti: 18,
  devatenact: 19,
  devatenacti: 19,
  dvacet: 20,
  dvaciti: 20,
  "dvacet jedna": 21,
  "dvacet jednu": 21,
  "dvacet dve": 22,
  "dvacet dva": 22,
  "dvacet tri": 23,
};

const MINUTE_WORDS: Record<string, number> = {
  pet: 5,
  deset: 10,
  patnact: 15,
  dvacet: 20,
  "dvacet pet": 25,
  tricet: 30,
  "tricet pet": 35,
  ctyricet: 40,
  "ctyricet pet": 45,
  padesat: 50,
  "padesat pet": 55,
};

// „půl desáté“ je půl hodiny před desátou.
const ORDINALS: Record<string, number> = {
  jedne: 1,
  jednu: 1,
  prvni: 1,
  druhe: 2,
  druhou: 2,
  druhy: 2,
  treti: 3,
  ctvrte: 4,
  ctvrtou: 4,
  ctvrty: 4,
  pate: 5,
  patou: 5,
  paty: 5,
  seste: 6,
  sestou: 6,
  sesty: 6,
  sedme: 7,
  sedmou: 7,
  sedmy: 7,
  osme: 8,
  osmou: 8,
  osmy: 8,
  devate: 9,
  devatou: 9,
  devaty: 9,
  desate: 10,
  desatou: 10,
  desaty: 10,
  jedenacte: 11,
  jedenactou: 11,
  dvanacte: 12,
  dvanactou: 12,
};

const PRE = "(?:ve\\s+|v\\s*|o\\s+|pred\\s+)?";
const FILLER = "(?:(?:kolem|asi|priblizne|cca)\\s+)?";
const PERIOD = "(?:\\s+(rano|dopoledne|odpoledne|vecer))?";
const SUFFIX =
  "(?:\\s*\\.?\\s*(?:hodin(?:a|y|u|e|ou|ach|am)?|hod\\.?|h))(?![\\p{L}\\p{N}])";

function alt(words: string[]): string {
  return [...words].sort((a, b) => b.length - a.length).join("|");
}

const hourAlt = alt(Object.keys(HOUR_WORDS));
const minuteAlt = alt(Object.keys(MINUTE_WORDS));
const ordinalAlt = alt(Object.keys(ORDINALS));

function formatClock(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function applyPeriod(hour: number, period: string | undefined): number | null {
  if (hour < 0 || hour > 23) return null;
  if (!period) return hour;
  if (period === "rano" || period === "dopoledne") {
    if (hour === 12) return 0;
    return hour <= 12 ? hour : null;
  }
  if (period === "odpoledne" || period === "vecer") {
    if (hour === 12) return 12;
    return hour < 12 ? hour + 12 : hour;
  }
  return hour;
}

function beforeHour(
  ordinal: number,
  minute: number
): { hour: number; minute: number } | null {
  if (ordinal < 1 || ordinal > 12) return null;
  const hour = ordinal === 1 ? 12 : ordinal - 1;
  return { hour, minute };
}

function skip(folded: string, start: number, text: string): boolean {
  if (/(?:^|\s)za\s+$/.test(folded.slice(0, start))) return true;
  const marked =
    /:|hod|\bpul\b|\bctvrt\b|poledne|pulnoc|rano|vecer|odpoledne|dopoledne/.test(
      text
    ) || /\dh(?![\p{L}\p{N}])/u.test(text);
  if (marked) return false;
  return /^\s+(?:den|dny|dne|dni|dnech|tyden|tydny|tydnu|tydne|mesic|mesice|mesicu|mesici|rok|roky|roku|let)(?![\p{L}\p{N}])/u.test(
    folded.slice(start + text.length)
  );
}

function take(
  folded: string,
  found: ClockHit[],
  re: RegExp,
  build: (match: RegExpMatchArray) => { hour: number; minute: number } | null
) {
  for (const match of folded.matchAll(re)) {
    const start = match.index ?? 0;
    if (skip(folded, start, match[0])) continue;
    const built = build(match);
    if (!built) continue;
    const period = match[match.length - 1];
    const hour = applyPeriod(
      built.hour,
      typeof period === "string" &&
        /rano|dopoledne|odpoledne|vecer/.test(period)
        ? period
        : undefined
    );
    if (hour == null) continue;
    const time = formatClock(hour, built.minute);
    if (!time) continue;
    found.push({ start, end: start + match[0].length, time });
  }
}

function pointOnClock(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const value = Number(token);
    return value >= 1 && value <= 12 ? value : null;
  }
  const named = ORDINALS[token] ?? HOUR_WORDS[token];
  if (named == null || named < 1 || named > 12) return null;
  return named;
}

export function findClocks(folded: string): ClockHit[] {
  const found: ClockHit[] = [];

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}(?:poledne|pulnoci|pulnoc)${PERIOD}(?![\\p{L}\\p{N}])`,
      "gu"
    ),
    (match) => ({
      hour: match[0].includes("poledne") ? 12 : 0,
      minute: 0,
    })
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}pul (${hourAlt}|\\d{1,2}|${ordinalAlt})${PERIOD}(?![\\p{L}\\p{N}])`,
      "gu"
    ),
    (match) => {
      const ordinal = pointOnClock(match[1] ?? "");
      if (ordinal == null) return null;
      return beforeHour(ordinal, 30);
    }
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}(tri ctvrte|ctvrt) na (${hourAlt}|\\d{1,2}|${ordinalAlt})${PERIOD}(?![\\p{L}\\p{N}])`,
      "gu"
    ),
    (match) => {
      const ordinal = pointOnClock(match[2] ?? "");
      if (ordinal == null) return null;
      return beforeHour(ordinal, match[1] === "ctvrt" ? 15 : 45);
    }
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}(\\d{1,2}):(\\d{2})(?!\\d)(?:\\s*${SUFFIX})?${PERIOD}`,
      "gu"
    ),
    (match) => ({ hour: Number(match[1]), minute: Number(match[2]) })
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}(\\d{1,2})\\.(\\d{2})(?!\\d)(?:${SUFFIX})?${PERIOD}(?![\\p{L}\\p{N}])`,
      "gu"
    ),
    (match) => {
      const minute = Number(match[2]);
      const hasSuffix = /hod|\dh(?![\p{L}\p{N}])/u.test(match[0]);
      if (!hasSuffix && ![0, 15, 30, 45].includes(minute)) return null;
      return { hour: Number(match[1]), minute };
    }
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])(?:ve\\s+|v\\s*|o\\s+|pred\\s+)${FILLER}(\\d{1,2})(?:\\s+(\\d{2})(?!\\d)|(?::(\\d{2}))?)(?:\\s*${SUFFIX})?${PERIOD}(?![\\p{L}\\p{N}])`,
      "gu"
    ),
    (match) => ({
      hour: Number(match[1]),
      minute: Number(match[2] ?? match[3] ?? 0),
    })
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])${PRE}${FILLER}(\\d{1,2})(?:\\s*[:.](\\d{2})(?!\\d))?(?:${SUFFIX})${PERIOD}`,
      "gu"
    ),
    (match) => ({ hour: Number(match[1]), minute: Number(match[2] ?? 0) })
  );

  take(
    folded,
    found,
    new RegExp(
      `(?<![\\p{L}\\p{N}])(?:(?:ve\\s+|v\\s*|o\\s+|pred\\s+)${FILLER}(${hourAlt})(?:\\s+(${minuteAlt}))?(?:${SUFFIX})?|(?<![\\p{L}\\p{N}])${FILLER}(${hourAlt})(?:\\s+(${minuteAlt}))?${SUFFIX})${PERIOD}`,
      "gu"
    ),
    (match) => {
      const word = match[1] ?? match[3] ?? "";
      const minuteWord = match[2] ?? match[4] ?? "";
      const hour = HOUR_WORDS[word];
      if (hour == null) return null;
      const minute = minuteWord ? MINUTE_WORDS[minuteWord] : 0;
      if (minuteWord && minute == null) return null;
      return { hour, minute: minute ?? 0 };
    }
  );

  return keepLongest(found);
}

function keepLongest(found: ClockHit[]): ClockHit[] {
  const sorted = [...found].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: ClockHit[] = [];
  let end = -1;
  for (const hit of sorted) {
    if (hit.start < end) continue;
    kept.push(hit);
    end = hit.end;
  }
  return kept;
}
