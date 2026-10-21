import { addDays, dueDateKey } from "./dates.ts";
import {
  alive,
  byId,
  descendantFolderIds,
  inboxFolder,
  isClosedOut,
  resolvedClosed,
  resolvedOpen,
  statusesOf,
  statusMeaning,
} from "./db.ts";
import { planIsDue } from "./horizon.ts";
import { byOrder } from "./ordering.ts";
import { fold, words } from "./text.ts";
import type {
  Db,
  Folder,
  Item,
  SavedView,
  Status,
  ViewQuery,
} from "./types.ts";

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

export function folderConcealed(db: Db, folder: Folder): boolean {
  let current: Folder | null = folder;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.hidden === true) return true;
    seen.add(current.id);
    current = current.parentId
      ? byId(db.folders, current.parentId) ?? null
      : null;
  }
  return false;
}

export function shownChildFolders(
  db: Db,
  parentId: string | null,
  showHidden: boolean
): Folder[] {
  return childFolders(db, parentId).filter(
    (folder) => showHidden || !folderConcealed(db, folder)
  );
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

export function folderItems(
  db: Db,
  folderId: string,
  includeDescendants: boolean
): Item[] {
  const ids = new Set([
    folderId,
    ...(includeDescendants ? descendantFolderIds(db, folderId) : []),
  ]);
  return visibleItems(db)
    .filter((item) => ids.has(item.folderId))
    .sort(byOrder);
}

export function visibleItems(db: Db): Item[] {
  const hiddenFolders = new Set(
    db.folders
      .filter((folder) => folder.isDeleted || folder.isArchived)
      .map((folder) => folder.id)
  );
  return alive(db.items).filter(
    (item) => !item.isArchived && !hiddenFolders.has(item.folderId)
  );
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

export function checkboxTarget(
  db: Db,
  item: Item
): { folderId: string; statusId: string } | null {
  const folder = byId(db.folders, item.folderId);
  if (!folder) return null;
  const open = resolvedOpen(db, folder);
  const closed = resolvedClosed(db, folder);
  if (!open || !closed) return null;
  return {
    folderId: folder.id,
    statusId: item.statusId === closed.id ? open.id : closed.id,
  };
}

export function mapStatus(
  db: Db,
  fromStatusId: string | null,
  toFolderId: string
): { statusId: string | null; choices: Status[] } {
  const meaning = statusMeaning(db, fromStatusId) ?? "todo";
  const choices = statusesOf(db, toFolderId).filter(
    (status) => status.meaning === meaning
  );
  if (choices.length === 1) return { statusId: choices[0]!.id, choices: [] };
  if (choices.length === 0) {
    const folder = byId(db.folders, toFolderId);
    return {
      statusId: folder ? resolvedOpen(db, folder)?.id ?? null : null,
      choices: [],
    };
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
  const ids = new Set(
    alive(db.itemTags)
      .filter((link) => link.itemId === itemId)
      .map((link) => link.tagId)
  );
  return alive(db.tags)
    .filter((tag) => ids.has(tag.id))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export function tagItems(db: Db, tagId: string): Item[] {
  const ids = new Set(
    alive(db.itemTags)
      .filter((link) => link.tagId === tagId)
      .map((link) => link.itemId)
  );
  return visibleItems(db)
    .filter((item) => ids.has(item.id))
    .sort(byOrder);
}

export function searchTags(db: Db, query: string) {
  const needle = fold(query).trim().replace(/^#+/, "");
  if (!needle) return [];
  return alive(db.tags)
    .filter((tag) => fold(tag.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"))
    .slice(0, 6);
}

export function linksOf(db: Db, itemId: string) {
  return alive(db.itemLinks).filter(
    (link) => link.fromId === itemId || link.toId === itemId
  );
}

export function otherId(
  link: { fromId: string; toId: string },
  itemId: string
): string {
  return link.fromId === itemId ? link.toId : link.fromId;
}

export function dependenciesOf(db: Db, itemId: string) {
  return alive(db.dependencies).filter(
    (row) => row.itemId === itemId || row.dependsOnId === itemId
  );
}

export function blockingItems(db: Db, itemId: string): Item[] {
  return alive(db.dependencies)
    .filter((row) => row.itemId === itemId)
    .map((row) => byId(db.items, row.dependsOnId))
    .filter(
      (item): item is Item =>
        item !== null && !item.isDeleted && !isClosedOut(db, item.statusId)
    );
}

export function blockedItems(db: Db, itemId: string): Item[] {
  return alive(db.dependencies)
    .filter((row) => row.dependsOnId === itemId)
    .map((row) => byId(db.items, row.itemId))
    .filter((item): item is Item => item !== null && !item.isDeleted);
}

function isReady(db: Db, item: Item): boolean {
  return (
    item.type === "task" &&
    isOpenItem(db, item) &&
    blockingItems(db, item.id).length === 0
  );
}

const SOON_DAYS = 7;

export type FocusId = "overdue" | "today" | "soon" | "priority" | "ready";

export function focusSections(
  db: Db,
  today: string
): { id: FocusId; items: Item[] }[] {
  const until = addDays(today, SOON_DAYS);
  const overdue: Item[] = [];
  const dueToday: Item[] = [];
  const soon: Item[] = [];
  const priority: Item[] = [];
  const ready: Item[] = [];
  for (const item of visibleItems(db)) {
    if (item.type !== "task" || !isOpenItem(db, item)) continue;
    const due = dueDateKey(item.dueAt);
    if (due && due < today) {
      overdue.push(item);
      continue;
    }
    if (due === today || planIsDue(item.plannedFor, item.planUntil, today, item.priority)) {
      dueToday.push(item);
      continue;
    }
    if (soonKey(item, today, until)) {
      soon.push(item);
      continue;
    }
    if (item.priority === "urgent" || item.priority === "high") {
      priority.push(item);
      continue;
    }
    if (isReady(db, item)) ready.push(item);
  }
  const byDue = (a: Item, b: Item) =>
    (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || byOrder(a, b);
  overdue.sort(byDue);
  dueToday.sort(byDue);
  soon.sort(
    (a, b) =>
      (soonKey(a, today, until) ?? "").localeCompare(
        soonKey(b, today, until) ?? ""
      ) || byOrder(a, b)
  );
  priority.sort(
    (a, b) =>
      Number(a.priority !== "urgent") - Number(b.priority !== "urgent") ||
      byOrder(a, b)
  );
  ready.sort(byOrder);
  return [
    { id: "overdue" as const, items: overdue },
    { id: "today" as const, items: dueToday },
    { id: "soon" as const, items: soon },
    { id: "priority" as const, items: priority },
    { id: "ready" as const, items: ready },
  ].filter((section) => section.items.length > 0);
}

function soonKey(item: Item, today: string, until: string): string | null {
  const marks = [dueDateKey(item.dueAt), item.plannedFor].filter(
    (key): key is string => Boolean(key && key > today && key <= until)
  );
  marks.sort();
  return marks[0] ?? null;
}

export function searchItems(db: Db, query: string): Item[] {
  const needle = fold(query).trim();
  if (!needle) return [];
  return visibleItems(db)
    .filter((item) => {
      const tagNames = tagsOf(db, item.id)
        .map((tag) => tag.name)
        .join(" ");
      return fold(`${item.title}\n${item.body ?? ""}\n${tagNames}`).includes(
        needle
      );
    })
    .slice(0, 40);
}

export function suggestFolders(db: Db, title: string): Folder[] {
  const tokens = words(title);
  if (tokens.length === 0) return [];
  const scores = new Map<string, number>();
  const add = (folderId: string, amount: number) =>
    scores.set(folderId, (scores.get(folderId) ?? 0) + amount);
  for (const folder of activeFolders(db)) {
    if (folder.system === "inbox") continue;
    const name = fold(folder.name);
    const keywords = new Set(words(folder.keywords ?? ""));
    for (const token of tokens) {
      if (keywords.has(token) || name === token) add(folder.id, 3);
      else if (name.includes(token)) add(folder.id, 1);
    }
  }
  // „koupit“ ve dvou složkách žádnou nenavrhne. Počítá se slovo, které žije jen v jedné.
  const homes = new Map<string, Set<string>>();
  for (const item of alive(db.items)) {
    const folder = byId(db.folders, item.folderId);
    if (!folder || folder.isDeleted || folder.system === "inbox") continue;
    for (const token of words(item.title)) {
      const set = homes.get(token) ?? new Set<string>();
      set.add(folder.id);
      homes.set(token, set);
    }
  }
  for (const token of tokens) {
    const set = homes.get(token);
    if (!set || set.size !== 1) continue;
    add([...set][0]!, 1);
  }
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => byId(db.folders, id))
    .filter(
      (folder): folder is Folder =>
        folder !== null && !folder.isDeleted && folder.system !== "inbox"
    );
}

export function applyQuery(db: Db, query: ViewQuery): Item[] {
  const folderIds = query.folderId
    ? new Set([
        query.folderId,
        ...(query.includeDescendants
          ? descendantFolderIds(db, query.folderId)
          : []),
      ])
    : null;
  return visibleItems(db)
    .filter((item) => {
      if (folderIds && !folderIds.has(item.folderId)) return false;
      if (query.type && item.type !== query.type) return false;
      if (query.openOnly && !isOpenItem(db, item)) return false;
      if (query.assigneeId && item.assigneeId !== query.assigneeId)
        return false;
      if (
        query.tagId &&
        !tagsOf(db, item.id).some((tag) => tag.id === query.tagId)
      )
        return false;
      if (
        query.text &&
        !fold(`${item.title}\n${item.body ?? ""}`).includes(fold(query.text))
      )
        return false;
      return true;
    })
    .sort(byOrder);
}

export function personItems(db: Db, personId: string): Item[] {
  return visibleItems(db)
    .filter((item) => item.assigneeId === personId && item.type === "task")
    .sort(byOrder);
}

export function openTaskCount(db: Db, folderId: string): number {
  return folderItems(db, folderId, true).filter(
    (item) => item.type === "task" && isOpenItem(db, item)
  ).length;
}

export function inboxWaitingCount(db: Db): number {
  const inbox = inboxFolder(db);
  if (!inbox) return 0;
  return alive(db.items).filter(
    (item) =>
      item.folderId === inbox.id &&
      !item.isArchived &&
      !isClosedOut(db, item.statusId)
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

export {
  alive,
  byId,
  inboxFolder,
  resolvedClosed,
  resolvedOpen,
  statusesOf,
  statusMeaning,
};
