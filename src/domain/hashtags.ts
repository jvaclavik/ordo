import { alive } from "./db.ts";
import type { Op } from "./op.ts";
import { tagsOf } from "./select.ts";
import { fold } from "./text.ts";
import type { Db, Item, ItemPatch } from "./types.ts";

export function pullHashtags(text: string): { text: string; names: string[] } {
  const names: string[] = [];
  const tag = /(^|[\t (])#([\p{L}\p{N}_-]{1,40})/gu;
  const lines = text.split("\n").map((line) =>
    line
      .replace(tag, (_match, lead: string, name: string) => {
        names.push(name);
        return lead === "(" ? "(" : "";
      })
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
  return {
    text: lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, ""),
    names,
  };
}

export function removeToken(text: string, start: number, end: number): string {
  return `${text.slice(0, start)}${text.slice(end)}`
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function hashtagOps(
  db: Db,
  itemId: string,
  names: string[],
  ids: () => string
): Op[] {
  if (names.length === 0) return [];
  const ops: Op[] = [];
  const current = tagsOf(db, itemId);
  const tagIds = current.map((tag) => tag.id);
  const seen = new Set(current.map((tag) => fold(tag.name)));
  for (const name of names) {
    const key = fold(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = alive(db.tags).find((tag) => fold(tag.name) === key);
    const id = found?.id ?? ids();
    if (!found) ops.push({ type: "ensureTag", id, name, color: null });
    tagIds.push(id);
  }
  if (tagIds.length === current.length) return ops;
  ops.push({ type: "setItemTags", itemId, tagIds });
  return ops;
}

export function taskTextOps(
  db: Db,
  item: Item,
  patch: { title?: string; body?: string | null },
  names: string[],
  ids: () => string
): Op[] {
  const nextPatch: ItemPatch = {};
  if (patch.title !== undefined && patch.title.trim() && patch.title !== item.title) {
    nextPatch.title = patch.title;
  }
  if (patch.body !== undefined && (patch.body ?? null) !== (item.body ?? null)) {
    nextPatch.body = patch.body;
  }
  const tagOps = item.type === "task" ? hashtagOps(db, item.id, names, ids) : [];
  const ops: Op[] = [...tagOps];
  if (nextPatch.title !== undefined || nextPatch.body !== undefined) {
    ops.push({ type: "updateItem", id: item.id, patch: nextPatch, fileInbox: true });
  }
  return ops;
}
