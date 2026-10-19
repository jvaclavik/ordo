import { findClocks } from "./clock.ts";
import {
  addDays,
  nextWeekday,
  resolveMonthDay,
  weekdayFromName,
} from "./dates.ts";
import { alive, byId, inboxFolder, resolvedOpen } from "./db.ts";
import { newItem } from "./factory.ts";
import { findHorizons } from "./horizon.ts";
import type { DateRole, Op } from "./op.ts";
import { priorityFromToken } from "./op.ts";
import { reduce } from "./reduce.ts";
import { fold, foldWithMap, originalSpan } from "./text.ts";
import type { Ctx, Db, Folder, Priority } from "./types.ts";

export type ChipKind =
  | "tag"
  | "person"
  | "priority"
  | "date"
  | "time"
  | "horizon"
  | "folder"
  | "folderMissing";

export type Chip = {
  kind: ChipKind;
  label: string;
  start: number;
  end: number;
};

export type ParsedQuickAdd = {
  title: string;
  body: string | null;
  chips: Chip[];
  tagNames: string[];
  personNames: string[];
  priority: Priority | null;
  dueDay: string | null;
  dueTime: string | null;
  planFrom: string | null;
  planUntil: string | null;
  folderId: string | null;
  folderMissing: boolean;
};

type Hit = {
  start: number;
  end: number;
  priority: number;
  apply: (span: { start: number; end: number }) => void;
};

export function parseQuickAdd(
  text: string,
  db: Db,
  today: string
): ParsedQuickAdd {
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const rest = newline === -1 ? "" : text.slice(newline + 1).trim();
  const { text: folded, starts } = foldWithMap(firstLine);
  const hits: Hit[] = [];
  let dueDay: string | null = null;
  let dueTime: string | null = null;
  let planFrom: string | null = null;
  let planUntil: string | null = null;
  let priority: Priority | null = null;
  let folderId: string | null = null;
  let folderMissing = false;
  const tagNames: string[] = [];
  const personNames: string[] = [];
  const chips: Chip[] = [];

  const remember =
    (kind: ChipKind, label: string, extra?: () => void) =>
    (span: { start: number; end: number }) => {
      chips.push({ kind, label, ...span });
      extra?.();
    };

  for (const path of folderPaths(db)) {
    const needle = `/${path.folded}`;
    let from = 0;
    while (from < folded.length) {
      const index = folded.indexOf(needle, from);
      if (index === -1) break;
      const end = index + needle.length;
      const boundary =
        end >= folded.length || !/[\p{L}\p{N}]/u.test(folded[end] ?? "");
      if (index === 0 || /[\s(]/.test(folded[index - 1] ?? " ")) {
        if (boundary) {
          hits.push({
            start: index,
            end,
            priority: 0,
            apply: remember("folder", path.label, () => {
              folderId = path.id;
            }),
          });
        }
      }
      from = index + 1;
    }
  }

  const pathRe = /\/[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*/gu;
  for (const match of folded.matchAll(pathRe)) {
    const before = match.index === 0 ? " " : folded[match.index - 1] ?? " ";
    if (match.index !== 0 && !/[\s(]/.test(before)) continue;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      priority: 2,
      apply: remember("folderMissing", "složka nenalezena", () => {
        folderMissing = true;
      }),
    });
  }

  const dates: {
    re: RegExp;
    run: (match: RegExpMatchArray) => { day?: string; time?: string } | null;
  }[] = [
    {
      re: /(?<![\p{L}\p{N}])pristi tyden(?![\p{L}\p{N}])/gu,
      run: () => ({ day: addDays(today, 7) }),
    },
    {
      re: /(?<![\p{L}\p{N}])pozitri(?![\p{L}\p{N}])/gu,
      run: () => ({ day: addDays(today, 2) }),
    },
    {
      re: /(?<![\p{L}\p{N}])(?:zejtra|zitra)(?![\p{L}\p{N}])/gu,
      run: () => ({ day: addDays(today, 1) }),
    },
    {
      re: /(?<![\p{L}\p{N}])dneska(?![\p{L}\p{N}])/gu,
      run: () => ({ day: today }),
    },
    {
      re: /(?<![\p{L}\p{N}])dnes(?![\p{L}\p{N}])/gu,
      run: () => ({ day: today }),
    },
    {
      re: /za (\d{1,3}) (den|dny|dni)/g,
      run: (match) => ({ day: addDays(today, Number(match[1])) }),
    },
    {
      re: /pondeli|utery|streda|ctvrtek|patek|sobota|nedele|(?<![\p{L}\p{N}])(po|ut|st|ct|pa|so|ne)(?![\p{L}\p{N}])/gu,
      run: (match) => {
        const weekday = weekdayFromName(match[0]);
        return weekday ? { day: nextWeekday(today, weekday) } : null;
      },
    },
    {
      re: /(?<![\p{L}\p{N}])(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?(?![\p{L}\p{N}])/gu,
      run: (match) => {
        const day = resolveMonthDay(
          today,
          Number(match[1]),
          Number(match[2]),
          match[3] ? Number(match[3]) : undefined
        );
        return day ? { day } : null;
      },
    },
  ];

  for (const match of findHorizons(folded, today)) {
    hits.push({
      start: match.start,
      end: match.end,
      priority: 1,
      apply: (span) => {
        planFrom = match.horizon.from;
        planUntil = match.horizon.until;
        chips.push({ kind: "horizon", label: match.horizon.label, ...span });
      },
    });
  }

  for (const pattern of dates) {
    for (const match of folded.matchAll(pattern.re)) {
      const built = pattern.run(match);
      if (!built) continue;
      hits.push({
        start: match.index,
        end: match.index + match[0].length,
        priority: 1,
        apply: (span) => {
          if (built.day) {
            dueDay = built.day;
            chips.push({ kind: "date", label: built.day, ...span });
          }
          if (built.time) {
            dueTime = built.time;
            chips.push({ kind: "time", label: built.time, ...span });
          }
        },
      });
    }
  }

  for (const match of folded.matchAll(
    /!(nizka|vysoka|urgentni|[1-4])(?![\p{L}\p{N}])/gu
  )) {
    const token = match[1] ?? "";
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      priority: 1,
      apply: remember(
        "priority",
        priorityLabel(priorityFromToken(token)),
        () => {
          priority = priorityFromToken(token);
        }
      ),
    });
  }

  for (const match of folded.matchAll(/#([\p{L}\p{N}_-]{1,40})/gu)) {
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      priority: 1,
      apply: (span) => {
        const name = firstLine.slice(span.start + 1, span.end);
        tagNames.push(name);
        chips.push({ kind: "tag", label: name, ...span });
      },
    });
  }

  for (const clock of findClocks(folded)) {
    hits.push({
      start: clock.start,
      end: clock.end,
      priority: 1,
      apply: (span) => {
        dueTime = clock.time;
        chips.push({ kind: "time", label: clock.time, ...span });
      },
    });
  }

  for (const spoken of spokenFolders(folded, db)) {
    hits.push({
      start: spoken.start,
      end: spoken.end,
      priority: 0,
      apply: remember("folder", spoken.label, () => {
        folderId = spoken.id;
      }),
    });
  }

  for (const spoken of spokenTags(folded, db)) {
    hits.push({
      start: spoken.start,
      end: spoken.end,
      priority: 1,
      apply: (span) => {
        const nameSpan = originalSpan(
          firstLine,
          starts,
          spoken.nameStart,
          spoken.nameEnd
        );
        const name =
          spoken.name ?? firstLine.slice(nameSpan.start, nameSpan.end);
        tagNames.push(name);
        chips.push({ kind: "tag", label: name, ...span });
      },
    });
  }

  for (const match of folded.matchAll(/@([\p{L}\p{N}_-]{1,40})/gu)) {
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      priority: 1,
      apply: (span) => {
        const name = firstLine.slice(span.start + 1, span.end);
        personNames.push(name);
        chips.push({ kind: "person", label: name, ...span });
      },
    });
  }

  const chosen = chooseHits(hits);
  const spans = chosen.map((hit) => {
    const span = originalSpan(firstLine, starts, hit.start, hit.end);
    hit.apply(span);
    return span;
  });

  let title = firstLine;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    title = `${title.slice(0, span.start)} ${title.slice(span.end)}`;
  }
  title = title.replace(/\s+/g, " ").trim();
  if (
    !title &&
    (rest ||
      dueDay ||
      dueTime ||
      planFrom ||
      folderId ||
      tagNames.length > 0 ||
      personNames.length > 0)
  )
    title = "Bez názvu";

  return {
    title,
    body: rest || null,
    chips: chips.sort((a, b) => a.start - b.start),
    tagNames,
    personNames,
    priority,
    dueDay,
    dueTime,
    planFrom,
    planUntil,
    folderId,
    folderMissing,
  };
}

export function opsFromQuickAdd(
  db: Db,
  parsed: ParsedQuickAdd,
  options: {
    folderId: string;
    statusId: string | null;
    dateRole: DateRole;
    applyRules: boolean;
    itemId: string;
    ids: () => string;
  }
): Op[] {
  const ops: Op[] = [];
  const tagIds: string[] = [];
  const seenTags = new Set<string>();
  for (const name of parsed.tagNames) {
    const key = fold(name);
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    const existing = alive(db.tags).find((tag) => fold(tag.name) === key);
    const id = existing?.id ?? options.ids();
    if (!existing) ops.push({ type: "ensureTag", id, name, color: null });
    tagIds.push(id);
  }
  let assigneeId: string | null = null;
  const personName = parsed.personNames[0];
  if (personName) {
    const existing = alive(db.people).find(
      (person) => fold(person.name) === fold(personName)
    );
    assigneeId = existing?.id ?? options.ids();
    if (!existing)
      ops.push({
        type: "createPerson",
        id: assigneeId,
        name: personName,
        color: null,
        emoji: null,
      });
  }
  const folder = byId(db.folders, options.folderId) ?? inboxFolder(db);
  if (!folder) return ops;
  const status =
    options.statusId &&
    byId(db.statuses, options.statusId)?.folderId === folder.id
      ? options.statusId
      : resolvedOpen(db, folder)?.id ?? null;
  const horizon = Boolean(parsed.planFrom);
  const dueAt = horizon ? null : combine(parsed.dueDay, parsed.dueTime);
  const plannedFor = horizon ? parsed.planFrom : null;
  const planUntil = horizon ? parsed.planUntil : null;
  ops.push({
    type: "createItem",
    item: newItem({
      id: options.itemId,
      folderId: folder.id,
      title: parsed.title,
      body: parsed.body,
      statusId: status,
      priority: parsed.priority,
      assigneeId,
      dueAt,
      dueHasTime: !horizon && Boolean(parsed.dueTime),
      plannedFor,
      planUntil,
      applyRules: options.applyRules,
      tagIds,
    }),
  });
  return ops;
}

export function taskLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function opsFromTaskDraft(
  db: Db,
  text: string,
  options: {
    folderId: string;
    statusId: string | null;
    dateRole: DateRole;
    applyRules: boolean;
    ids: () => string;
    today: string;
  }
): { ops: Op[]; itemIds: string[] } {
  const parsed = parseQuickAdd(text, db, options.today);
  if (
    !parsed.title.trim() ||
    (parsed.title === "Bez názvu" && parsed.chips.length === 0 && !parsed.body)
  )
    return { ops: [], itemIds: [] };
  const itemId = options.ids();
  const folderId = parsed.folderId ?? options.folderId;
  const ops = opsFromQuickAdd(db, parsed, {
    folderId,
    statusId: folderId === options.folderId ? options.statusId : null,
    dateRole: options.dateRole,
    applyRules: options.applyRules,
    itemId,
    ids: options.ids,
  });
  if (!ops.some((op) => op.type === "createItem"))
    return { ops: [], itemIds: [] };
  return { ops, itemIds: [itemId] };
}

export function opsFromTaskLines(
  db: Db,
  text: string,
  options: {
    folderId: string;
    statusId: string | null;
    dateRole: DateRole;
    applyRules: boolean;
    ids: () => string;
    today: string;
  }
): { ops: Op[]; itemIds: string[] } {
  const ops: Op[] = [];
  const itemIds: string[] = [];
  let state = db;
  let scratch = 0;
  const scratchCtx: Ctx = {
    now: options.today,
    today: options.today,
    id: () => `draft${scratch++}`,
  };
  for (const line of taskLines(text)) {
    const parsed = parseQuickAdd(line, state, options.today);
    if (
      !parsed.title.trim() ||
      (parsed.title === "Bez názvu" && parsed.chips.length === 0)
    )
      continue;
    const itemId = options.ids();
    const folderId = parsed.folderId ?? options.folderId;
    const lineOps = opsFromQuickAdd(state, parsed, {
      folderId,
      statusId: folderId === options.folderId ? options.statusId : null,
      dateRole: options.dateRole,
      applyRules: options.applyRules,
      itemId,
      ids: options.ids,
    });
    if (!lineOps.some((op) => op.type === "createItem")) continue;
    ops.push(...lineOps);
    itemIds.push(itemId);
    state = lineOps.reduce((next, op) => reduce(next, op, scratchCtx), state);
  }
  return { ops, itemIds };
}

function combine(day: string | null, time: string | null): string | null {
  if (!day) return null;
  return time ? `${day}T${time}` : day;
}

function priorityLabel(priority: Priority | null): string {
  if (priority === "low") return "nízká";
  if (priority === "high") return "vysoká";
  if (priority === "urgent") return "urgentní";
  return "běžná";
}

function chooseHits(hits: Hit[]): Hit[] {
  const ordered = [...hits].sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      a.priority - b.priority
  );
  const chosen: Hit[] = [];
  let cursor = 0;
  for (const hit of ordered) {
    if (hit.start < cursor) continue;
    chosen.push(hit);
    cursor = hit.end;
  }
  return chosen;
}

export type SlashFolder = {
  id: string;
  folded: string;
  label: string;
  token: string;
  color: Folder["color"];
  icon: string | null;
};

export function lineAt(
  text: string,
  caret: number
): { start: number; end: number; text: string } {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const start = text.lastIndexOf("\n", clamped - 1) + 1;
  const breakAt = text.indexOf("\n", clamped);
  const end = breakAt === -1 ? text.length : breakAt;
  return { start, end, text: text.slice(start, end) };
}

export function slashAtCaret(
  text: string,
  caret: number
): { start: number; end: number; query: string } | null {
  if (caret < 0 || caret > text.length) return null;
  const line = lineAt(text, caret);
  let slash = -1;
  for (let index = caret - 1; index >= line.start; index -= 1) {
    const char = text[index] ?? "";
    if (char !== "/") continue;
    const before = index === 0 ? " " : text[index - 1] ?? " ";
    if (/[\s(]/.test(before)) {
      slash = index;
      break;
    }
  }
  if (slash === -1) return null;
  return { start: slash, end: caret, query: text.slice(slash + 1, caret) };
}

export function suggestSlashFolders(db: Db, query: string): SlashFolder[] {
  const needle = fold(query.trim());
  return folderPaths(db)
    .filter((folder) => slashScore(folder.folded, needle) > 0)
    .sort((a, b) => {
      const byScore =
        slashScore(b.folded, needle) - slashScore(a.folded, needle);
      if (byScore !== 0) return byScore;
      return a.label.localeCompare(b.label, "cs");
    })
    .slice(0, 8);
}

export function slashQueryExact(db: Db, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return false;
  return folderPaths(db).some((folder) => folder.folded === needle);
}

const TAG_CHAR = /^[\p{L}\p{N}_-]$/u;

export type TagHint = { id: string; name: string; color: string | null };

export function hashAtCaret(
  text: string,
  caret: number
): { start: number; end: number; query: string } | null {
  if (caret < 0 || caret > text.length) return null;
  const line = lineAt(text, caret);
  let index = caret;
  while (index > line.start && TAG_CHAR.test(text[index - 1] ?? "")) index -= 1;
  if (index === line.start || text[index - 1] !== "#") return null;
  const hash = index - 1;
  if (hash > line.start && !/[\s(]/.test(text[hash - 1] ?? "")) return null;
  return { start: hash, end: caret, query: text.slice(hash + 1, caret) };
}

export function suggestTags(db: Db, query: string): TagHint[] {
  const needle = fold(query.trim());
  return alive(db.tags)
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      score: tagScore(fold(tag.name), needle),
    }))
    .filter((tag) => tag.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "cs"))
    .slice(0, 8)
    .map(({ id, name, color }) => ({ id, name, color }));
}

export function tagQueryExact(db: Db, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return false;
  return alive(db.tags).some((tag) => fold(tag.name) === needle);
}

export function tokenAtCaret(
  text: string,
  caret: number
):
  | { kind: "tag"; start: number; end: number; query: string }
  | { kind: "folder"; start: number; end: number; query: string }
  | null {
  const hash = hashAtCaret(text, caret);
  const slash = slashAtCaret(text, caret);
  if (hash && (!slash || hash.start >= slash.start))
    return { kind: "tag", start: hash.start, end: hash.end, query: hash.query };
  if (slash)
    return {
      kind: "folder",
      start: slash.start,
      end: slash.end,
      query: slash.query,
    };
  return null;
}

function tagScore(name: string, needle: string) {
  if (!needle) return 1;
  if (name.startsWith(needle)) return 4;
  if (name.includes(needle)) return 2;
  return 0;
}

function slashScore(path: string, needle: string): number {
  if (!needle) return 1;
  const name = path.split("/").pop() ?? path;
  if (name.startsWith(needle) || path.startsWith(needle)) return 4;
  if (path.split("/").some((part) => part.startsWith(needle))) return 3;
  if (name.includes(needle) || path.includes(needle)) return 2;
  return 0;
}

const FOLDER_CUE =
  /(?<![\p{L}\p{N}])(?:do\s+|ve\s+|v\s+)?(?:slozk(?:a|u|y|e|ou|o)|adresar(?:em|i|e)?|kategori(?:emi|i|e))(?![\p{L}\p{N}])\s+/gu;

const TAG_CUE =
  /(?<![\p{L}\p{N}])(?:hashtag(?:em|u)?|tag(?:em|u)?|stit(?:kem|ky|ku|ek))(?![\p{L}\p{N}])\s+/gu;

function followingWords(
  folded: string,
  index: number
): { word: string; end: number }[] {
  const words: { word: string; end: number }[] = [];
  let cursor = index;
  while (words.length < 4) {
    const match = /^[\p{L}\p{N}_-]+/u.exec(folded.slice(cursor));
    if (!match) break;
    words.push({ word: match[0], end: cursor + match[0].length });
    cursor += match[0].length;
    const space = /^\s+/u.exec(folded.slice(cursor));
    if (!space) break;
    cursor += space[0].length;
  }
  return words;
}

function spokenFolders(
  folded: string,
  db: Db
): { start: number; end: number; id: string; label: string }[] {
  const found = [];
  for (const match of folded.matchAll(FOLDER_CUE)) {
    const start = match.index ?? 0;
    const words = followingWords(folded, start + match[0].length);
    const picked = bestSpokenFolder(
      db,
      words.map((word) => word.word)
    );
    const last = picked ? words[picked.consume - 1] : undefined;
    if (!picked || !last) continue;
    found.push({ start, end: last.end, id: picked.id, label: picked.label });
  }
  return found;
}

function spokenTags(
  folded: string,
  db: Db
): {
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  name: string | null;
}[] {
  const found = [];
  const tags = alive(db.tags);
  for (const match of folded.matchAll(TAG_CUE)) {
    const start = match.index ?? 0;
    const nameStart = start + match[0].length;
    const words = followingWords(folded, nameStart);
    if (words.length === 0) continue;
    let consume = 1;
    let name: string | null = null;
    for (let count = Math.min(3, words.length); count >= 1; count -= 1) {
      const key = words
        .slice(0, count)
        .map((word) => word.word)
        .join(" ");
      const existing = tags.find((tag) => fold(tag.name) === key);
      if (!existing) continue;
      consume = count;
      name = existing.name;
      break;
    }
    const last = words[consume - 1];
    if (!last) continue;
    found.push({ start, end: last.end, nameStart, nameEnd: last.end, name });
  }
  return found;
}

function bestSpokenFolder(
  db: Db,
  words: string[]
): { id: string; label: string; consume: number } | null {
  if (words.length === 0) return null;
  const folders = folderPaths(db);
  const candidates: {
    id: string;
    label: string;
    consume: number;
    score: number;
  }[] = [];
  const limit = Math.min(4, words.length);
  for (const folder of folders) {
    const pathWords = folder.folded.split("/");
    const name = pathWords[pathWords.length - 1] ?? folder.folded;
    for (let count = 1; count <= limit; count += 1) {
      const query = words.slice(0, count);
      const joined = query.join(" ");
      const slashed = query.join("/");
      let score = 0;
      if (slashed === folder.folded || joined === name || slashed === name)
        score = 100;
      else if (
        count === pathWords.length &&
        pathWords.every(
          (part, index) =>
            part === query[index] ||
            (query[index] != null &&
              query[index].length >= 3 &&
              part.startsWith(query[index]))
        )
      )
        score = 90;
      else if (name.startsWith(joined) && joined.length >= 3)
        score = 70 + Math.min(15, joined.length);
      else if (
        count === 1 &&
        pathWords.length === 1 &&
        closeWord(query[0] ?? "", name)
      )
        score = 60;
      if (score > 0)
        candidates.push({
          id: folder.id,
          label: folder.label,
          consume: count,
          score,
        });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.score >= 90) - Number(a.score >= 90) ||
      b.consume - a.consume ||
      b.score - a.score
  );
  const best = candidates[0];
  if (!best) return null;
  const ambiguous = candidates.some(
    (other) =>
      other.id !== best.id &&
      other.score === best.score &&
      other.consume === best.consume
  );
  if (ambiguous) return null;
  return best;
}

function closeWord(query: string, name: string): boolean {
  if (query === name) return true;
  if (query.length < 4 || name.length < 4) return false;
  const distance = levenshtein(query, name);
  return distance <= (Math.min(query.length, name.length) >= 8 ? 2 : 1);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let diagonal = prev[0] ?? 0;
    prev[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const next = prev[j + 1] ?? 0;
      const cost = a[i] === b[j] ? 0 : 1;
      prev[j + 1] = Math.min((prev[j] ?? 0) + 1, next + 1, diagonal + cost);
      diagonal = next;
    }
  }
  return prev[b.length] ?? 0;
}

function folderPaths(db: Db): SlashFolder[] {
  const folders = alive(db.folders).filter((folder) => !folder.isArchived);
  const byFolder = new Map(folders.map((folder) => [folder.id, folder]));
  const cache = new Map<string, Omit<SlashFolder, "id">>();
  const pathOf = (folder: Folder): Omit<SlashFolder, "id"> => {
    const cached = cache.get(folder.id);
    if (cached) return cached;
    const parent = folder.parentId ? byFolder.get(folder.parentId) : undefined;
    const parentPath = parent ? pathOf(parent) : null;
    const value = {
      folded: parentPath
        ? `${parentPath.folded}/${fold(folder.name)}`
        : fold(folder.name),
      label: parentPath ? `${parentPath.label} / ${folder.name}` : folder.name,
      token: parentPath
        ? `${parentPath.token}/${folder.name}`
        : `/${folder.name}`,
      color: folder.color,
      icon: folder.icon,
    };
    cache.set(folder.id, value);
    return value;
  };
  return folders
    .map((folder) => ({ id: folder.id, ...pathOf(folder) }))
    .sort((a, b) => b.folded.length - a.folded.length);
}
