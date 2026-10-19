import { generateKeyBetween } from "fractional-indexing";
import { alive, byId } from "./db.ts";
import { byOrder } from "./ordering.ts";
import type { Db, Item, ItemSort, Priority } from "./types.ts";

function priorityRank(priority: Priority | null): number {
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "low") return 3;
  return 2;
}

export function rankCompare(
  mode: ItemSort,
  left: { priority: Priority | null; createdAt: string },
  right: { priority: Priority | null; createdAt: string },
): number {
  if (mode === "priority") return priorityRank(left.priority) - priorityRank(right.priority);
  if (left.createdAt > right.createdAt) return -1;
  if (left.createdAt < right.createdAt) return 1;
  return 0;
}

function between(prev: string | null, next: string | null): string {
  const left = prev && prev.length > 0 ? prev : null;
  const right = next && next.length > 0 ? next : null;
  if (left && right && left >= right) return generateKeyBetween(left, null);
  return generateKeyBetween(left, right);
}

function columnTasks(db: Db, folderId: string, statusId: string | null, exceptId?: string): Item[] {
  return alive(db.items).filter(
    (item) =>
      item.type === "task" &&
      !item.isArchived &&
      item.folderId === folderId &&
      item.statusId === statusId &&
      item.id !== exceptId,
  );
}

export function sortKeyFor(
  db: Db,
  folderId: string,
  statusId: string | null,
  candidate: { id?: string; priority: Priority | null; createdAt: string },
  mode: ItemSort,
): string {
  const others = columnTasks(db, folderId, statusId, candidate.id).sort(
    (left, right) => rankCompare(mode, left, right) || byOrder(left, right),
  );
  const found = others.findIndex((entry) => rankCompare(mode, candidate, entry) < 0);
  const at = found === -1 ? others.length : found;
  const prev = at > 0 ? others[at - 1]!.sortOrder : null;
  const next = at < others.length ? others[at]!.sortOrder : null;
  return between(prev, next);
}

export function applyItemSort(db: Db, folderId: string, mode: ItemSort, now: string): Db {
  const groups = new Map<string, Item[]>();
  for (const item of alive(db.items)) {
    if (item.type !== "task" || item.isArchived || item.folderId !== folderId) continue;
    const key = item.statusId ?? "";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const assigned = new Map<string, string>();
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => rankCompare(mode, left, right) || byOrder(left, right));
    const keys = [...new Set(ordered.map((item) => item.sortOrder).filter((key) => key.length > 0))].sort();
    let prev = keys.length > 0 ? keys[keys.length - 1]! : null;
    while (keys.length < ordered.length) {
      const key = generateKeyBetween(prev, null);
      keys.push(key);
      prev = key;
    }
    ordered.forEach((item, index) => assigned.set(item.id, keys[index]!));
  }
  if (assigned.size === 0) return db;
  let changed = false;
  const items = db.items.map((item) => {
    const sortOrder = assigned.get(item.id);
    if (!sortOrder || sortOrder === item.sortOrder) return item;
    changed = true;
    return { ...item, sortOrder, updatedAt: now };
  });
  return changed ? { ...db, items } : db;
}

export function clearItemSort(db: Db, folderId: string, now: string): Db {
  if (!byId(db.folders, folderId)?.itemSort) return db;
  return {
    ...db,
    folders: db.folders.map((row) => (row.id === folderId ? { ...row, itemSort: null, updatedAt: now } : row)),
  };
}
