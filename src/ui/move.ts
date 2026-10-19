import { generateKeyBetween } from "fractional-indexing";
import { alive, byId, resolvedClosed, resolvedOpen, statusesOf } from "../domain/db.ts";
import { keyAtIndex } from "../domain/ordering.ts";
import type { Op } from "../domain/op.ts";
import { openSubtasks } from "../domain/select.ts";
import type { Db, Item, Status } from "../domain/types.ts";

export function placeOp(db: Db, itemId: string, folderId: string, statusId: string, beforeId?: string, manual = false): Op {
  const siblings = alive(db.items)
    .filter((item) => item.folderId === folderId && item.statusId === statusId && item.id !== itemId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  const found = beforeId ? siblings.findIndex((item) => item.id === beforeId) : siblings.length;
  const index = found < 0 ? siblings.length : found;
  const op: Op = {
    type: "placeItem",
    id: itemId,
    folderId,
    statusId,
    sortOrder: keyAtIndex(siblings.map((item) => item.sortOrder), index),
  };
  return manual ? { ...op, manual: true } : op;
}

export function placeMany(db: Db, ids: string[], folderId: string, statusId: string, beforeId?: string, manual = false): Op[] {
  const moving = new Set(ids);
  const siblings = alive(db.items)
    .filter((item) => item.folderId === folderId && item.statusId === statusId && !moving.has(item.id))
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  const ordered = ids
    .flatMap((id) => {
      const item = byId(db.items, id);
      return item && !item.isDeleted ? [item] : [];
    })
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
  if (ordered.length === 0) return [];
  const found = beforeId ? siblings.findIndex((item) => item.id === beforeId) : siblings.length;
  const index = found < 0 ? siblings.length : found;
  const keys = siblings.map((item) => item.sortOrder);
  let prev = index > 0 ? keys[index - 1]! : null;
  const next = index < keys.length ? keys[index]! : null;
  return ordered.map((item) => {
    const sortOrder = generateKeyBetween(prev, next);
    prev = sortOrder;
    const op: Op = { type: "placeItem", id: item.id, folderId, statusId, sortOrder };
    return manual ? { ...op, manual: true } : op;
  });
}

export function placeCreated(db: Db, ids: string[], folderId: string): Op[] {
  const folder = byId(db.folders, folderId);
  const statusId = folder ? resolvedOpen(db, folder)?.id : undefined;
  if (!folder || !statusId) return [];
  return placeMany(db, ids, folder.id, statusId);
}

export function statusForMeaning(db: Db, folderId: string, meaning: Status["meaning"]): Status[] {
  return statusesOf(db, folderId).filter((status) => status.meaning === meaning);
}

export function completionOps(db: Db, item: Item, includeSubtasks: boolean): Op[] {
  const folder = byId(db.folders, item.folderId);
  if (!folder) return [];
  const closed = resolvedClosed(db, folder);
  const open = statusesOf(db, folder.id).find((status) => status.id === folder.openStatusId) ?? statusesOf(db, folder.id).find((status) => status.meaning === "todo");
  const target = item.statusId === closed?.id ? open : closed;
  if (!target) return [];
  const ops = [placeOp(db, item.id, folder.id, target.id)];
  if (includeSubtasks && target.id === closed?.id) {
    for (const child of openSubtasks(db, item.id)) {
      const childFolder = byId(db.folders, child.folderId);
      const childClosed = childFolder ? resolvedClosed(db, childFolder) : null;
      if (childClosed) ops.push(placeOp(db, child.id, child.folderId, childClosed.id));
    }
  }
  return ops;
}
