import {
  alive,
  byId,
  descendantFolderIds,
  inboxFolder,
  isClosedOut,
  isDoneStatus,
  resolvedClosed,
  resolvedOpen,
  statusesOf,
  statusMeaning,
} from "./db.ts";
import { byOrder } from "./ordering.ts";
import { dueDateKey } from "./dates.ts";
import { planIsDue } from "./horizon.ts";
import { fold, words } from "./text.ts";
import type { Db, Folder, Item, SavedView, Status, ViewQuery } from "./types.ts";

export function activeFolders(db: Db): Folder[] {
  return alive(db.folders)
    .filter((folder) => !folder.isArchived)
    .sort(byOrder);
}

export function childFolders(db: Db, parentId: string | null): Folder[] {
  return activeFolders(db)
    .filter((folder) => folder.parentId === parentId)
    .sort(byOrder);
}

export function folderTrail(db: Db, folderId: string | null): Folder[] {
  const trail: Folder[] = [];
  let current = byId(db.folders, folderId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = byId(db.folders, current.parentId);
  }
  return trail;
}

export function folderItems(db: Db, folderId: string, includeDescendants: boolean): Item[] {
  const ids = new Set([folderId, ...(includeDescendants ? descendantFolderIds(db, folderId) : [])]);
  return visibleItems(db)
    .filter((item) => ids.has(item.folderId))
    .sort(byOrder);
}

export function visibleItems(db: Db): Item[] {
  const hiddenFolders = new Set(
    db.folders.filter((folder) => folder.isDeleted || folder.isArchived).map((folder) => folder.id),
  );
  return alive(db.items).filter((item) => !item.isArchived && !hiddenFolders.has(item.folderId));
}

export function isChecked(db: Db, item: Item): boolean {
  const folder = byId(db.folders, item.folderId);
  if (!folder) return false;
  const closed = resolvedClosed(db, folder);
  return closed !== null && item.statusId === closed.id;
}

export function isOpenItem(db: Db, item: Item): boolean {
  return !isClosedOut(db, item.statusId);
}

export function checkboxTarget(db: Db, item: Item): { folderId: string; statusId: string } | null {
  const folder = byId(db.folders, item.folderId);
  if (!folder) return null;
  const open = resolvedOpen(db, folder);
  const closed = resolvedClosed(db, folder);
  if (!open || !closed) return null;
  return { folderId: folder.id, statusId: item.statusId === closed.id ? open.id : closed.id };
}

export function mapStatus(db: Db, fromStatusId: string | null, toFolderId: string): { statusId: string | null; choices: Status[] } {
  const meaning = statusMeaning(db, fromStatusId) ?? "todo";
  const choices = statusesOf(db, toFolderId).filter((status) => status.meaning === meaning);
  if (choices.length === 1) return { statusId: choices[0]!.id, choices: [] };
  if (choices.length === 0) {
    const folder = byId(db.folders, toFolderId);
    return { statusId: folder ? (resolvedOpen(db, folder)?.id ?? null) : null, choices: [] };
  }
  return { statusId: null, choices };
}

export function subtasksOf(db: Db, itemId: string): Item[] {
  return visibleItems(db)
    .filter((item) => item.parentItemId === itemId)
    .sort(byOrder);
}

export function openSubtasks(db: Db, itemId: string): Item[] {
  return subtasksOf(db, itemId).filter((item) => isOpenItem(db, item));
}

export function tagsOf(db: Db, itemId: string) {
  const ids = new Set(alive(db.itemTags).filter((link) => link.itemId === itemId).map((link) => link.tagId));
  return alive(db.tags).filter((tag) => ids.has(tag.id)).sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export function linksOf(db: Db, itemId: string) {
  return alive(db.itemLinks).filter((link) => link.fromId === itemId || link.toId === itemId);
}

export function otherId(link: { fromId: string; toId: string }, itemId: string): string {
  return link.fromId === itemId ? link.toId : link.fromId;
}

export function dependenciesOf(db: Db, itemId: string) {
  return alive(db.dependencies).filter((row) => row.itemId === itemId || row.dependsOnId === itemId);
}

export function blockingItems(db: Db, itemId: string): Item[] {
  return alive(db.dependencies)
    .filter((row) => row.itemId === itemId)
    .map((row) => byId(db.items, row.dependsOnId))
    .filter((item): item is Item => item !== null && !item.isDeleted && !isClosedOut(db, item.statusId));
}

export function blockedItems(db: Db, itemId: string): Item[] {
  return alive(db.dependencies)
    .filter((row) => row.dependsOnId === itemId)
    .map((row) => byId(db.items, row.itemId))
    .filter((item): item is Item => item !== null && !item.isDeleted);
}

export function isReady(db: Db, item: Item): boolean {
  return item.type === "task" && isOpenItem(db, item) && blockingItems(db, item.id).length === 0;
}

export function readyItems(db: Db): Item[] {
  return visibleItems(db).filter((item) => isReady(db, item));
}

export type TodaySections = {
  planned: Item[];
  due: Item[];
  overdue: Item[];
};

export function todaySections(db: Db, today: string): TodaySections {
  const planned: Item[] = [];
  const due: Item[] = [];
  const overdue: Item[] = [];
  for (const item of visibleItems(db)) {
    if (item.type !== "task" || !isOpenItem(db, item)) continue;
    const dueKey = dueDateKey(item.dueAt);
    if (planIsDue(item.plannedFor, item.planUntil, today)) {
      planned.push(item);
      continue;
    }
    if (dueKey === today) due.push(item);
    else if (dueKey && dueKey < today) overdue.push(item);
  }
  const byDue = (a: Item, b: Item) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || byOrder(a, b);
  planned.sort(byOrder);
  due.sort(byDue);
  overdue.sort(byDue);
  return { planned, due, overdue };
}

export function searchItems(db: Db, query: string): Item[] {
  const needle = fold(query).trim();
  if (!needle) return [];
  return visibleItems(db)
    .filter((item) => {
      const tagNames = tagsOf(db, item.id).map((tag) => tag.name).join(" ");
      return fold(`${item.title}\n${item.body ?? ""}\n${item.store ?? ""}\n${tagNames}`).includes(needle);
    })
    .slice(0, 40);
}

export function suggestFolders(db: Db, title: string): Folder[] {
  const tokens = words(title);
  if (tokens.length === 0) return [];
  const scores = new Map<string, number>();
  const add = (folderId: string, amount: number) => scores.set(folderId, (scores.get(folderId) ?? 0) + amount);
  for (const folder of activeFolders(db)) {
    if (folder.system === "inbox") continue;
    const name = fold(folder.name);
    const keywords = new Set(words(folder.keywords ?? ""));
    for (const token of tokens) {
      if (keywords.has(token) || name === token) add(folder.id, 3);
      else if (name.includes(token)) add(folder.id, 1);
    }
  }
  for (const item of alive(db.items)) {
    const itemWords = new Set(words(item.title));
    if (tokens.some((token) => itemWords.has(token))) add(item.folderId, 1);
  }
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => byId(db.folders, id))
    .filter((folder): folder is Folder => folder !== null && !folder.isDeleted && folder.system !== "inbox");
}

export function applyQuery(db: Db, query: ViewQuery): Item[] {
  const folderIds = query.folderId
    ? new Set([query.folderId, ...(query.includeDescendants ? descendantFolderIds(db, query.folderId) : [])])
    : null;
  return visibleItems(db)
    .filter((item) => {
      if (folderIds && !folderIds.has(item.folderId)) return false;
      if (query.type && item.type !== query.type) return false;
      if (query.openOnly && !isOpenItem(db, item)) return false;
      if (query.assigneeId && item.assigneeId !== query.assigneeId) return false;
      if (query.store && fold(item.store ?? "") !== fold(query.store)) return false;
      if (query.tagId && !tagsOf(db, item.id).some((tag) => tag.id === query.tagId)) return false;
      if (query.text && !fold(`${item.title}\n${item.body ?? ""}`).includes(fold(query.text))) return false;
      return true;
    })
    .sort(byOrder);
}

export function personItems(db: Db, personId: string): Item[] {
  return visibleItems(db)
    .filter((item) => item.assigneeId === personId && item.type === "task")
    .sort(byOrder);
}

export function shoppingOpen(db: Db): Item[] {
  return visibleItems(db)
    .filter((item) => item.type === "task" && isOpenItem(db, item) && (item.store || item.templateId))
    .sort(byOrder);
}

export function shoppingDone(db: Db): Item[] {
  return visibleItems(db)
    .filter((item) => item.type === "task" && isDoneStatus(db, item.statusId) && (item.store || item.templateId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function openTaskCount(db: Db, folderId: string): number {
  return folderItems(db, folderId, true).filter((item) => item.type === "task" && isOpenItem(db, item)).length;
}

export function inboxWaitingCount(db: Db): number {
  const inbox = inboxFolder(db);
  if (!inbox) return 0;
  return alive(db.items).filter(
    (item) => item.folderId === inbox.id && !item.isArchived && !isClosedOut(db, item.statusId),
  ).length;
}

export function seriesItems(db: Db, item: Item): Item[] {
  const series = item.seriesId ?? item.id;
  return alive(db.items)
    .filter((other) => other.id === series || other.seriesId === series)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function viewsFor(db: Db, folderId: string | null): SavedView[] {
  return alive(db.savedViews)
    .filter((view) => view.folderId === folderId)
    .sort(byOrder);
}

export { byId, inboxFolder, resolvedClosed, resolvedOpen, statusesOf, statusMeaning, alive };
