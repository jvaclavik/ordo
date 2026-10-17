import { generateKeyBetween } from "fractional-indexing";
import {
  alive,
  bootstrap,
  byId,
  descendantFolderIds,
  inboxFolder,
  isClosedOut,
  isDoneStatus,
  isValidDb,
  resolvedOpen,
  seriesIdOf,
  sortKeyForStatus,
  statusesOf,
  workspaceId,
  wouldDependencyCycle,
  wouldFolderCycle,
} from "./db.ts";
import { normalizeFolderColor } from "./color.ts";
import { keyAtEnd } from "./ordering.ts";
import type { Op } from "./op.ts";
import { nextOccurrence, recurrenceOf, weekdaysTo } from "./recurrence.ts";
import { matchingRule } from "./rules.ts";
import { fold } from "./text.ts";
import type { Ctx, Db, FolderPatch, Item, ItemPatch, NewItem, Rule, Status } from "./types.ts";

export function reduce(db: Db, op: Op, ctx: Ctx): Db {
  switch (op.type) {
    case "batch":
      return op.ops.reduce((next, child) => reduce(next, child, ctx), db);
    case "replaceDb":
      return isValidDb(op.db) ? op.db : db;
    case "emptyTrash":
      return emptyTrash(db);
    case "createFolder":
      return createFolder(db, op, ctx);
    case "updateFolder":
      return updateFolder(db, op.id, op.patch, ctx);
    case "moveFolder":
      return moveFolder(db, op, ctx);
    case "deleteFolder":
      return deleteFolder(db, op.id, ctx);
    case "restoreFolder":
      return restoreFolder(db, op.id, ctx);
    case "createStatus":
      return createStatus(db, op, ctx);
    case "updateStatus":
      return updateStatus(db, op, ctx);
    case "reorderStatuses":
      return reorderStatuses(db, op.folderId, op.orderedIds, ctx);
    case "deleteStatus":
      return deleteStatus(db, op.id, ctx);
    case "createItem":
      return createItem(db, op.item, ctx);
    case "updateItem":
      return updateItem(db, op.id, op.patch, ctx, op.fileInbox === true);
    case "placeItem":
      return placeItem(db, op, ctx);
    case "deleteItem":
      return mapItem(db, op.id, (item) => ({ ...item, isDeleted: true, updatedAt: ctx.now }));
    case "restoreItem":
      return restoreItem(db, op.id, ctx);
    case "ensureTag":
      return ensureTag(db, op, ctx);
    case "updateTag":
      return mapTag(db, op.id, (tag) => ({
        ...tag,
        name: op.name?.trim() || tag.name,
        color: op.color !== undefined ? op.color : tag.color,
        updatedAt: ctx.now,
      }));
    case "deleteTag":
      return deleteTag(db, op.id, ctx);
    case "setItemTags":
      return setItemTags(db, op.itemId, op.tagIds, ctx);
    case "createPerson":
      return createPerson(db, op, ctx);
    case "updatePerson":
      return mapPerson(db, op.id, (person) => ({
        ...person,
        name: op.name?.trim() || person.name,
        color: op.color !== undefined ? op.color : person.color,
        emoji: op.emoji !== undefined ? op.emoji : person.emoji,
        updatedAt: ctx.now,
      }));
    case "deletePerson":
      return deletePerson(db, op.id, ctx);
    case "addDependency":
      return addDependency(db, op, ctx);
    case "removeDependency":
      return mapDependency(db, op.id, (row) => ({ ...row, isDeleted: true, updatedAt: ctx.now }));
    case "addLink":
      return addLink(db, op, ctx);
    case "removeLink":
      return {
        ...db,
        itemLinks: db.itemLinks.map((link) => (link.id === op.id ? { ...link, isDeleted: true, updatedAt: ctx.now } : link)),
      };
    case "makeTemplate":
      return makeTemplate(db, op.id, op.itemId, ctx);
    case "createTemplate":
      return createTemplate(db, op, ctx);
    case "updateTemplate":
      return updateTemplate(db, op, ctx);
    case "deleteTemplate":
      return {
        ...db,
        shoppingTemplates: db.shoppingTemplates.map((template) =>
          template.id === op.id ? { ...template, isDeleted: true, updatedAt: ctx.now } : template,
        ),
      };
    case "buyTemplate":
      return buyTemplate(db, op.templateId, op.itemId, ctx);
    case "createView":
      return createView(db, op, ctx);
    case "deleteView":
      return {
        ...db,
        savedViews: db.savedViews.map((view) => (view.id === op.id ? { ...view, isDeleted: true, updatedAt: ctx.now } : view)),
      };
    case "createRule":
      return createRule(db, op, ctx);
    case "updateRule":
      return updateRule(db, op, ctx);
    case "deleteRule":
      return {
        ...db,
        rules: db.rules.map((rule) => (rule.id === op.id ? { ...rule, isDeleted: true, updatedAt: ctx.now } : rule)),
      };
    case "reorderRules":
      return reorderRules(db, op.orderedIds, ctx);
    case "setRecurrence":
      return setRecurrence(db, op, ctx);
    case "sortInbox":
      return sortInbox(db, ctx);
    default:
      return db;
  }
}

export function freshDb(ctx: Ctx): Db {
  return bootstrap(ctx);
}

function createFolder(db: Db, op: Extract<Op, { type: "createFolder" }>, ctx: Ctx): Db {
  const name = op.name.trim().slice(0, 200);
  if (!name || byId(db.folders, op.id)) return db;
  if (op.parentId && (!byId(db.folders, op.parentId) || byId(db.folders, op.parentId)?.isDeleted)) return db;
  const ws = workspaceId(db);
  const siblings = alive(db.folders).filter((folder) => folder.parentId === op.parentId);
  const sortOrder = keyAtEnd(siblings.map((folder) => folder.sortOrder));
  const base = { createdAt: ctx.now, updatedAt: ctx.now, isDeleted: false, workspaceId: ws };
  const first = generateKeyBetween(null, null);
  const second = generateKeyBetween(first, null);
  const third = generateKeyBetween(second, null);
  const folder = {
    ...base,
    id: op.id,
    parentId: op.parentId,
    name,
    icon: op.icon,
    color: normalizeFolderColor(op.color),
    keywords: null,
    sortOrder,
    system: null,
    defaultView: "list" as const,
    openStatusId: null,
    closedStatusId: null,
    isArchived: false,
  };
  const statuses: Status[] = [
    { ...base, id: op.statusIds.todo, folderId: op.id, name: "K udělání", meaning: "todo", sortOrder: first },
    { ...base, id: op.statusIds.doing, folderId: op.id, name: "Dělám", meaning: "doing", sortOrder: second },
    { ...base, id: op.statusIds.done, folderId: op.id, name: "Hotovo", meaning: "done", sortOrder: third },
  ];
  return { ...db, folders: [...db.folders, folder], statuses: [...db.statuses, ...statuses] };
}

function updateFolder(db: Db, id: string, patch: FolderPatch, ctx: Ctx): Db {
  const folder = byId(db.folders, id);
  if (!folder || folder.isDeleted) return db;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) : folder.name;
  if (!name) return db;
  return {
    ...db,
    folders: db.folders.map((row) =>
      row.id === id
        ? {
            ...row,
            name: row.system === "inbox" ? row.name : name,
            icon: patch.icon !== undefined ? patch.icon : row.icon,
            color: patch.color !== undefined ? normalizeFolderColor(patch.color) : row.color,
            keywords: patch.keywords !== undefined ? patch.keywords : row.keywords,
            defaultView: patch.defaultView !== undefined ? patch.defaultView : row.defaultView,
            openStatusId: patch.openStatusId !== undefined ? patch.openStatusId : row.openStatusId,
            closedStatusId: patch.closedStatusId !== undefined ? patch.closedStatusId : row.closedStatusId,
            isArchived: patch.isArchived !== undefined ? patch.isArchived : row.isArchived,
            updatedAt: ctx.now,
          }
        : row,
    ),
  };
}

function moveFolder(db: Db, op: Extract<Op, { type: "moveFolder" }>, ctx: Ctx): Db {
  const folder = byId(db.folders, op.id);
  if (!folder || folder.isDeleted) return db;
  const parentId = folder.system === "inbox" ? null : op.parentId;
  if (parentId === folder.id || wouldFolderCycle(db, folder.id, parentId)) return db;
  if (parentId && byId(db.folders, parentId)?.isDeleted) return db;
  return {
    ...db,
    folders: db.folders.map((row) => (row.id === folder.id ? { ...row, parentId, sortOrder: op.sortOrder, updatedAt: ctx.now } : row)),
  };
}

function deleteFolder(db: Db, id: string, ctx: Ctx): Db {
  const folder = byId(db.folders, id);
  if (!folder || folder.system === "inbox" || folder.isDeleted) return db;
  const ids = new Set([id, ...descendantFolderIds(db, id)]);
  return {
    ...db,
    folders: db.folders.map((row) => (ids.has(row.id) ? { ...row, isDeleted: true, updatedAt: ctx.now } : row)),
    statuses: db.statuses.map((row) => (ids.has(row.folderId) ? { ...row, isDeleted: true, updatedAt: ctx.now } : row)),
    items: db.items.map((row) => (ids.has(row.folderId) && !row.isDeleted ? { ...row, isDeleted: true, updatedAt: ctx.now } : row)),
  };
}

function restoreFolder(db: Db, id: string, ctx: Ctx): Db {
  const folder = byId(db.folders, id);
  if (!folder) return db;
  const parentDeleted = folder.parentId ? byId(db.folders, folder.parentId)?.isDeleted : false;
  return {
    ...db,
    folders: db.folders.map((row) =>
      row.id === id ? { ...row, isDeleted: false, parentId: parentDeleted ? null : row.parentId, updatedAt: ctx.now } : row,
    ),
  };
}

function createStatus(db: Db, op: Extract<Op, { type: "createStatus" }>, ctx: Ctx): Db {
  const folder = byId(db.folders, op.folderId);
  const name = op.name.trim().slice(0, 80);
  if (!folder || folder.isDeleted || !name) return db;
  const sortOrder = keyAtEnd(statusesOf(db, folder.id).map((status) => status.sortOrder));
  return {
    ...db,
    statuses: [
      ...db.statuses,
      {
        id: op.id,
        workspaceId: folder.workspaceId,
        folderId: folder.id,
        name,
        meaning: op.meaning,
        sortOrder,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function updateStatus(db: Db, op: Extract<Op, { type: "updateStatus" }>, ctx: Ctx): Db {
  return {
    ...db,
    statuses: db.statuses.map((status) => {
      if (status.id !== op.id || status.isDeleted) return status;
      const name = op.name !== undefined ? op.name.trim().slice(0, 80) : status.name;
      if (!name) return status;
      return { ...status, name, meaning: op.meaning ?? status.meaning, updatedAt: ctx.now };
    }),
  };
}

function reorderStatuses(db: Db, folderId: string, orderedIds: string[], ctx: Ctx): Db {
  let previous: string | null = null;
  const keys = new Map<string, string>();
  for (const id of orderedIds) {
    const key = generateKeyBetween(previous, null);
    keys.set(id, key);
    previous = key;
  }
  return {
    ...db,
    statuses: db.statuses.map((status) => {
      const sortOrder = keys.get(status.id);
      if (!sortOrder || status.folderId !== folderId) return status;
      return { ...status, sortOrder, updatedAt: ctx.now };
    }),
  };
}

function deleteStatus(db: Db, id: string, ctx: Ctx): Db {
  const status = byId(db.statuses, id);
  if (!status || status.isDeleted) return db;
  const remaining = statusesOf(db, status.folderId).filter((row) => row.id !== id);
  if (remaining.length === 0) return db;
  const folder = byId(db.folders, status.folderId);
  const fallback = remaining.find((row) => row.meaning === "todo") ?? remaining[0]!;
  return {
    ...db,
    statuses: db.statuses.map((row) => (row.id === id ? { ...row, isDeleted: true, updatedAt: ctx.now } : row)),
    items: db.items.map((item) => (item.statusId === id ? { ...item, statusId: fallback.id, updatedAt: ctx.now } : item)),
    folders: db.folders.map((row) => {
      if (!folder || row.id !== folder.id) return row;
      return {
        ...row,
        openStatusId: row.openStatusId === id ? null : row.openStatusId,
        closedStatusId: row.closedStatusId === id ? null : row.closedStatusId,
        updatedAt: ctx.now,
      };
    }),
  };
}

function createItem(db: Db, input: NewItem, ctx: Ctx): Db {
  const title = input.title.trim().slice(0, 500);
  const requested = byId(db.folders, input.folderId) ?? inboxFolder(db);
  if (!requested || requested.isDeleted || !title || byId(db.items, input.id)) return db;
  let folder = requested;
  let statusId = input.statusId;
  let store = input.store;
  let tagIds = [...input.tagIds];
  if (input.applyRules && folder.system === "inbox") {
    const rule = matchingRule(db, { title, body: input.body }, tagIds);
    if (rule) {
      const applied = applyRuleTarget(db, rule, statusId);
      if (applied) {
        folder = applied.folder;
        statusId = applied.statusId;
        if (rule.actionStore) store = rule.actionStore;
        if (rule.actionTagId && !tagIds.includes(rule.actionTagId)) tagIds.push(rule.actionTagId);
      }
    }
  }
  if (!statusId || byId(db.statuses, statusId)?.folderId !== folder.id) statusId = resolvedOpen(db, folder)?.id ?? null;
  const sortOrder = input.sortOrder || sortKeyForStatus(db, folder.id, statusId);
  const item: Item = {
    id: input.id,
    workspaceId: folder.workspaceId,
    folderId: folder.id,
    type: input.type,
    title,
    body: input.body,
    statusId,
    priority: input.priority,
    assigneeId: input.assigneeId,
    dueAt: input.dueAt,
    dueHasTime: input.dueHasTime,
    plannedFor: input.plannedFor,
    planUntil: input.planUntil,
    store,
    quantity: input.quantity,
    unit: input.unit,
    spec: input.spec,
    templateId: input.templateId,
    parentItemId: input.parentItemId,
    seriesId: null,
    recurrenceFreq: null,
    recurrenceInterval: null,
    recurrenceWeekdays: null,
    recurrenceUntil: null,
    pristine: true,
    sortOrder,
    pinX: null,
    pinY: null,
    pinZ: null,
    pinW: null,
    pinH: null,
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const itemTags = tagIds
    .filter((tagId) => byId(db.tags, tagId) && !byId(db.tags, tagId)?.isDeleted)
    .map((tagId) => ({
      id: ctx.id(),
      workspaceId: folder.workspaceId,
      itemId: item.id,
      tagId,
      isDeleted: false,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }));
  return { ...db, items: [...db.items, item], itemTags: [...db.itemTags, ...itemTags] };
}

function applyRuleTarget(db: Db, rule: Rule, currentStatus: string | null): { folder: Db["folders"][number]; statusId: string | null } | null {
  const folder = byId(db.folders, rule.actionFolderId);
  if (!folder || folder.isDeleted) return null;
  const explicit = rule.actionStatusId ? byId(db.statuses, rule.actionStatusId) : null;
  const statusId = explicit && !explicit.isDeleted && explicit.folderId === folder.id ? explicit.id : (resolvedOpen(db, folder)?.id ?? currentStatus);
  return { folder, statusId };
}

function updateItem(db: Db, id: string, patch: ItemPatch, ctx: Ctx, fileInbox = false): Db {
  const item = byId(db.items, id);
  if (!item || item.isDeleted) return db;
  if (patch.parentItemId !== undefined && wouldParentCycle(db, id, patch.parentItemId)) return db;
  const title = patch.title !== undefined ? patch.title.trim().slice(0, 500) : item.title;
  if (!title) return db;
  const next = Object.keys(patch).length === 0
    ? db
    : mapItem(db, id, (row) => ({
        ...row,
        title,
        body: patch.body !== undefined ? patch.body : row.body,
        type: patch.type !== undefined ? patch.type : row.type,
        priority: patch.priority !== undefined ? patch.priority : row.priority,
        assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : row.assigneeId,
        dueAt: patch.dueAt !== undefined ? patch.dueAt : row.dueAt,
        dueHasTime: patch.dueHasTime !== undefined ? patch.dueHasTime : row.dueHasTime,
        plannedFor: patch.plannedFor !== undefined ? patch.plannedFor : row.plannedFor,
        planUntil: patch.planUntil !== undefined ? patch.planUntil : row.planUntil ?? null,
        store: patch.store !== undefined ? patch.store : row.store,
        quantity: patch.quantity !== undefined ? patch.quantity : row.quantity,
        unit: patch.unit !== undefined ? patch.unit : row.unit,
        spec: patch.spec !== undefined ? patch.spec : row.spec,
        templateId: patch.templateId !== undefined ? patch.templateId : row.templateId,
        parentItemId: patch.parentItemId !== undefined ? patch.parentItemId : row.parentItemId,
        sortOrder: patch.sortOrder ? patch.sortOrder : row.sortOrder,
        pinX: patch.pinX !== undefined ? patch.pinX : (row.pinX ?? null),
        pinY: patch.pinY !== undefined ? patch.pinY : (row.pinY ?? null),
        pinZ: patch.pinZ !== undefined ? patch.pinZ : (row.pinZ ?? null),
        pinW: patch.pinW !== undefined ? patch.pinW : (row.pinW ?? null),
        pinH: patch.pinH !== undefined ? patch.pinH : (row.pinH ?? null),
        isPinned: patch.isPinned !== undefined ? patch.isPinned : row.isPinned,
        isArchived: patch.isArchived !== undefined ? patch.isArchived : row.isArchived,
        pristine: false,
        updatedAt: ctx.now,
      }));
  return fileInbox ? fileInboxItem(next, id, ctx) : next;
}

function wouldParentCycle(db: Db, itemId: string, parentId: string | null): boolean {
  let current = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === itemId || seen.has(current)) return true;
    seen.add(current);
    current = byId(db.items, current)?.parentItemId ?? null;
  }
  return false;
}

function placeItem(db: Db, op: Extract<Op, { type: "placeItem" }>, ctx: Ctx): Db {
  const item = byId(db.items, op.id);
  const status = byId(db.statuses, op.statusId);
  const folder = byId(db.folders, op.folderId);
  if (!item || item.isDeleted || !status || status.isDeleted || !folder || folder.isDeleted) return db;
  if (status.folderId !== folder.id) return db;
  const wasDone = isDoneStatus(db, item.statusId);
  const nowDone = status.meaning === "done";
  db = mapItem(db, item.id, (row) => ({
    ...row,
    folderId: folder.id,
    statusId: status.id,
    sortOrder: op.sortOrder,
    pristine: false,
    updatedAt: ctx.now,
  }));
  if (!wasDone && nowDone && item.recurrenceFreq && item.type === "task") db = spawnFrom(db, item.id, ctx);
  if (wasDone && !nowDone) db = retractSpawn(db, item.id, ctx);
  return db;
}

function spawnFrom(db: Db, sourceId: string, ctx: Ctx): Db {
  const source = byId(db.items, sourceId);
  const rule = source ? recurrenceOf(source) : null;
  if (!source || !rule || source.type !== "task") return db;
  const day = nextOccurrence(ctx.today, rule);
  const seriesId = source.seriesId ?? source.id;
  db = mapItem(db, source.id, (row) => ({
    ...row,
    seriesId,
    recurrenceFreq: null,
    recurrenceInterval: null,
    recurrenceWeekdays: null,
    recurrenceUntil: null,
    updatedAt: ctx.now,
  }));
  if (!day) return db;
  const folder = byId(db.folders, source.folderId);
  if (!folder) return db;
  const open = resolvedOpen(db, folder);
  const id = ctx.id();
  const copy: Item = {
    ...source,
    id,
    seriesId,
    statusId: open?.id ?? null,
    plannedFor: day,
    planUntil: null,
    dueAt: source.dueAt ? shiftDue(source, day) : null,
    parentItemId: null,
    pristine: true,
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    sortOrder: sortKeyForStatus(db, folder.id, open?.id ?? null),
    recurrenceFreq: rule.freq,
    recurrenceInterval: rule.interval,
    recurrenceWeekdays: weekdaysTo(rule.weekdays),
    recurrenceUntil: rule.until,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const tags = alive(db.itemTags)
    .filter((link) => link.itemId === source.id)
    .map((link) => ({ ...link, id: ctx.id(), itemId: id, createdAt: ctx.now, updatedAt: ctx.now }));
  return { ...db, items: [...db.items, copy], itemTags: [...db.itemTags, ...tags] };
}

function shiftDue(source: Item, day: string): string {
  if (!source.dueHasTime || !source.dueAt || source.dueAt.length < 16) return day;
  return `${day}T${source.dueAt.slice(11, 16)}`;
}

function retractSpawn(db: Db, itemId: string, ctx: Ctx): Db {
  const item = byId(db.items, itemId);
  if (!item) return db;
  const series = seriesIdOf(item);
  const pristine = alive(db.items)
    .filter(
      (other) =>
        other.id !== item.id &&
        other.pristine &&
        !isDoneStatus(db, other.statusId) &&
        (other.seriesId === series || other.id === series),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (pristine.length === 0) return db;
  const donor = pristine[0]!;
  const drop = new Set(pristine.map((row) => row.id));
  return {
    ...db,
    items: db.items.map((row) => {
      if (drop.has(row.id)) return { ...row, isDeleted: true, updatedAt: ctx.now };
      if (row.id !== item.id) return row;
      return {
        ...row,
        seriesId: series,
        recurrenceFreq: donor.recurrenceFreq,
        recurrenceInterval: donor.recurrenceInterval,
        recurrenceWeekdays: donor.recurrenceWeekdays,
        recurrenceUntil: donor.recurrenceUntil,
        updatedAt: ctx.now,
      };
    }),
  };
}

function setRecurrence(db: Db, op: Extract<Op, { type: "setRecurrence" }>, ctx: Ctx): Db {
  const item = byId(db.items, op.itemId);
  if (!item || item.isDeleted || item.type !== "task") return db;
  const series = seriesIdOf(item);
  const members = alive(db.items).filter((other) => other.id === series || other.seriesId === series);
  const carrier = members.find((other) => other.recurrenceFreq && !isDoneStatus(db, other.statusId));
  if (!op.freq) {
    if (!carrier) return db;
    return clearRule(db, carrier.id, ctx);
  }
  const rule = {
    recurrenceFreq: op.freq,
    recurrenceInterval: Math.max(1, op.interval ?? 1),
    recurrenceWeekdays: op.weekdays,
    recurrenceUntil: op.until,
  };
  if (carrier) {
    return mapItem(db, carrier.id, (row) => ({ ...row, ...rule, updatedAt: ctx.now, pristine: row.id === item.id ? false : row.pristine }));
  }
  if (!isDoneStatus(db, item.statusId)) {
    return mapItem(db, item.id, (row) => ({ ...row, ...rule, pristine: false, updatedAt: ctx.now }));
  }
  db = mapItem(db, item.id, (row) => ({ ...row, ...rule, updatedAt: ctx.now }));
  return spawnFrom(db, item.id, ctx);
}

function clearRule(db: Db, id: string, ctx: Ctx): Db {
  return mapItem(db, id, (row) => ({
    ...row,
    recurrenceFreq: null,
    recurrenceInterval: null,
    recurrenceWeekdays: null,
    recurrenceUntil: null,
    updatedAt: ctx.now,
  }));
}

function restoreItem(db: Db, id: string, ctx: Ctx): Db {
  const item = byId(db.items, id);
  if (!item) return db;
  const folder = byId(db.folders, item.folderId);
  const inbox = inboxFolder(db);
  const folderMissing = !folder || folder.isDeleted;
  const target = folderMissing ? inbox : folder;
  if (!target) return db;
  const statusOk = item.statusId && byId(db.statuses, item.statusId)?.folderId === target.id && !byId(db.statuses, item.statusId)?.isDeleted;
  return mapItem(db, id, (row) => ({
    ...row,
    isDeleted: false,
    folderId: target.id,
    statusId: statusOk ? row.statusId : (resolvedOpen(db, target)?.id ?? null),
    updatedAt: ctx.now,
  }));
}

function ensureTag(db: Db, op: Extract<Op, { type: "ensureTag" }>, ctx: Ctx): Db {
  const name = op.name.trim().slice(0, 40);
  if (!name || alive(db.tags).some((tag) => fold(tag.name) === fold(name))) return db;
  return {
    ...db,
    tags: [
      ...db.tags,
      { id: op.id, workspaceId: workspaceId(db), name, color: op.color, isDeleted: false, createdAt: ctx.now, updatedAt: ctx.now },
    ],
  };
}

function deleteTag(db: Db, id: string, ctx: Ctx): Db {
  return {
    ...db,
    tags: db.tags.map((tag) => (tag.id === id ? { ...tag, isDeleted: true, updatedAt: ctx.now } : tag)),
    itemTags: db.itemTags.map((link) => (link.tagId === id ? { ...link, isDeleted: true, updatedAt: ctx.now } : link)),
  };
}

function setItemTags(db: Db, itemId: string, tagIds: string[], ctx: Ctx): Db {
  if (!byId(db.items, itemId)) return db;
  const wanted = new Set(tagIds);
  const itemTags = db.itemTags.map((link) => {
    if (link.itemId !== itemId) return link;
    const keep = wanted.has(link.tagId) && !byId(db.tags, link.tagId)?.isDeleted;
    return keep ? { ...link, isDeleted: false, updatedAt: ctx.now } : { ...link, isDeleted: true, updatedAt: ctx.now };
  });
  const present = new Set(itemTags.filter((link) => link.itemId === itemId && !link.isDeleted).map((link) => link.tagId));
  const ws = workspaceId(db);
  for (const tagId of wanted) {
    if (present.has(tagId) || byId(db.tags, tagId)?.isDeleted || !byId(db.tags, tagId)) continue;
    itemTags.push({ id: ctx.id(), workspaceId: ws, itemId, tagId, isDeleted: false, createdAt: ctx.now, updatedAt: ctx.now });
  }
  return fileInboxItem(
    mapItem({ ...db, itemTags }, itemId, (item) => ({ ...item, pristine: false, updatedAt: ctx.now })),
    itemId,
    ctx,
  );
}

function createPerson(db: Db, op: Extract<Op, { type: "createPerson" }>, ctx: Ctx): Db {
  const name = op.name.trim().slice(0, 80);
  if (!name || byId(db.people, op.id)) return db;
  return {
    ...db,
    people: [
      ...db.people,
      {
        id: op.id,
        workspaceId: workspaceId(db),
        name,
        color: op.color,
        emoji: op.emoji,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function deletePerson(db: Db, id: string, ctx: Ctx): Db {
  return {
    ...db,
    people: db.people.map((person) => (person.id === id ? { ...person, isDeleted: true, updatedAt: ctx.now } : person)),
    items: db.items.map((item) => (item.assigneeId === id ? { ...item, assigneeId: null, updatedAt: ctx.now } : item)),
  };
}

function addDependency(db: Db, op: Extract<Op, { type: "addDependency" }>, ctx: Ctx): Db {
  if (!byId(db.items, op.itemId) || !byId(db.items, op.dependsOnId)) return db;
  if (wouldDependencyCycle(db, op.itemId, op.dependsOnId)) return db;
  const existing = alive(db.dependencies).find((row) => row.itemId === op.itemId && row.dependsOnId === op.dependsOnId);
  if (existing) return db;
  return {
    ...db,
    dependencies: [
      ...db.dependencies,
      {
        id: op.id,
        workspaceId: workspaceId(db),
        itemId: op.itemId,
        dependsOnId: op.dependsOnId,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function addLink(db: Db, op: Extract<Op, { type: "addLink" }>, ctx: Ctx): Db {
  if (op.fromId === op.toId || !byId(db.items, op.fromId) || !byId(db.items, op.toId)) return db;
  const existing = alive(db.itemLinks).find(
    (link) => link.kind === op.kind && ((link.fromId === op.fromId && link.toId === op.toId) || (link.fromId === op.toId && link.toId === op.fromId)),
  );
  if (existing) return db;
  return {
    ...db,
    itemLinks: [
      ...db.itemLinks,
      {
        id: op.id,
        workspaceId: workspaceId(db),
        fromId: op.fromId,
        toId: op.toId,
        kind: op.kind,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function createTemplate(db: Db, op: Extract<Op, { type: "createTemplate" }>, ctx: Ctx): Db {
  const name = op.name.trim().slice(0, 200);
  if (!name) return db;
  const existing = alive(db.shoppingTemplates).find(
    (template) => fold(template.name) === fold(name) && fold(template.store ?? "") === fold(op.store ?? ""),
  );
  if (existing) return db;
  return {
    ...db,
    shoppingTemplates: [
      ...db.shoppingTemplates,
      {
        id: op.id,
        workspaceId: workspaceId(db),
        name,
        store: op.store,
        unit: op.unit,
        spec: op.spec,
        defaultQuantity: op.defaultQuantity,
        folderId: op.folderId,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function makeTemplate(db: Db, id: string, itemId: string, ctx: Ctx): Db {
  const item = byId(db.items, itemId);
  if (!item || item.isDeleted) return db;
  const existing = alive(db.shoppingTemplates).find(
    (template) => fold(template.name) === fold(item.title) && fold(template.store ?? "") === fold(item.store ?? ""),
  );
  const templateId = existing?.id ?? id;
  if (!existing) {
    db = {
      ...db,
      shoppingTemplates: [
        ...db.shoppingTemplates,
        {
          id,
          workspaceId: workspaceId(db),
          name: item.title,
          store: item.store,
          unit: item.unit,
          spec: item.spec,
          defaultQuantity: item.quantity,
          folderId: item.folderId,
          isDeleted: false,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        },
      ],
    };
  }
  return mapItem(db, item.id, (row) => ({ ...row, templateId, pristine: false, updatedAt: ctx.now }));
}

function updateTemplate(db: Db, op: Extract<Op, { type: "updateTemplate" }>, ctx: Ctx): Db {
  return {
    ...db,
    shoppingTemplates: db.shoppingTemplates.map((template) => {
      if (template.id !== op.id) return template;
      const name = op.name !== undefined ? op.name.trim() : template.name;
      if (!name) return template;
      return {
        ...template,
        name,
        store: op.store !== undefined ? op.store : template.store,
        unit: op.unit !== undefined ? op.unit : template.unit,
        spec: op.spec !== undefined ? op.spec : template.spec,
        defaultQuantity: op.defaultQuantity !== undefined ? op.defaultQuantity : template.defaultQuantity,
        folderId: op.folderId !== undefined ? op.folderId : template.folderId,
        updatedAt: ctx.now,
      };
    }),
  };
}

function buyTemplate(db: Db, templateId: string, itemId: string, ctx: Ctx): Db {
  const template = byId(db.shoppingTemplates, templateId);
  if (!template || template.isDeleted || byId(db.items, itemId)) return db;
  const already = alive(db.items).find((item) => item.templateId === template.id && !isClosedOut(db, item.statusId));
  if (already) return db;
  const folder = (template.folderId ? byId(db.folders, template.folderId) : null) ?? inboxFolder(db);
  if (!folder || folder.isDeleted) return db;
  return createItem(
    db,
    {
      id: itemId,
      folderId: folder.id,
      type: "task",
      title: template.name,
      body: template.spec,
      statusId: resolvedOpen(db, folder)?.id ?? null,
      priority: null,
      assigneeId: null,
      dueAt: null,
      dueHasTime: false,
      plannedFor: null,
      planUntil: null,
      store: template.store,
      quantity: template.defaultQuantity,
      unit: template.unit,
      spec: template.spec,
      templateId: template.id,
      parentItemId: null,
      sortOrder: "",
      applyRules: folder.system === "inbox",
      tagIds: [],
    },
    ctx,
  );
}

function createView(db: Db, op: Extract<Op, { type: "createView" }>, ctx: Ctx): Db {
  const name = op.name.trim().slice(0, 80);
  if (!name) return db;
  const sortOrder = keyAtEnd(alive(db.savedViews).map((view) => view.sortOrder));
  return {
    ...db,
    savedViews: [
      ...db.savedViews,
      {
        id: op.id,
        workspaceId: workspaceId(db),
        folderId: op.folderId,
        name,
        query: op.query,
        sortOrder,
        isDeleted: false,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      },
    ],
  };
}

function createRule(db: Db, op: Extract<Op, { type: "createRule" }>, ctx: Ctx): Db {
  if (!op.matchText && !op.matchTagId) return db;
  if (!byId(db.folders, op.actionFolderId) || byId(db.folders, op.actionFolderId)?.isDeleted) return db;
  const sortOrder = keyAtEnd(alive(db.rules).map((rule) => rule.sortOrder));
  return sortInbox(
    {
      ...db,
      rules: [
        ...db.rules,
        {
          id: op.id,
          workspaceId: workspaceId(db),
          enabled: true,
          sortOrder,
          matchText: op.matchText,
          matchTagId: op.matchTagId,
          actionFolderId: op.actionFolderId,
          actionStatusId: op.actionStatusId,
          actionTagId: op.actionTagId,
          actionStore: op.actionStore,
          isDeleted: false,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        },
      ],
    },
    ctx,
  );
}

function updateRule(db: Db, op: Extract<Op, { type: "updateRule" }>, ctx: Ctx): Db {
  const next = {
    ...db,
    rules: db.rules.map((rule) => {
      if (rule.id !== op.id) return rule;
      return {
        ...rule,
        enabled: op.enabled !== undefined ? op.enabled : rule.enabled,
        matchText: op.matchText !== undefined ? op.matchText : rule.matchText,
        matchTagId: op.matchTagId !== undefined ? op.matchTagId : rule.matchTagId,
        actionFolderId: op.actionFolderId !== undefined ? op.actionFolderId : rule.actionFolderId,
        actionStatusId: op.actionStatusId !== undefined ? op.actionStatusId : rule.actionStatusId,
        actionTagId: op.actionTagId !== undefined ? op.actionTagId : rule.actionTagId,
        actionStore: op.actionStore !== undefined ? op.actionStore : rule.actionStore,
        updatedAt: ctx.now,
      };
    }),
  };
  const rule = byId(next.rules, op.id);
  return rule?.enabled && !rule.isDeleted ? sortInbox(next, ctx) : next;
}

function reorderRules(db: Db, orderedIds: string[], ctx: Ctx): Db {
  let previous: string | null = null;
  const keys = new Map<string, string>();
  for (const id of orderedIds) {
    const key = generateKeyBetween(previous, null);
    keys.set(id, key);
    previous = key;
  }
  return {
    ...db,
    rules: db.rules.map((rule) => (keys.has(rule.id) ? { ...rule, sortOrder: keys.get(rule.id)!, updatedAt: ctx.now } : rule)),
  };
}

function fileInboxItem(db: Db, itemId: string, ctx: Ctx): Db {
  const inbox = inboxFolder(db);
  const item = byId(db.items, itemId);
  if (!inbox || !item || item.isDeleted || item.folderId !== inbox.id || isClosedOut(db, item.statusId)) return db;
  const tagIds = alive(db.itemTags).filter((link) => link.itemId === item.id).map((link) => link.tagId);
  const rule = matchingRule(db, item, tagIds);
  if (!rule) return db;
  const applied = applyRuleTarget(db, rule, item.statusId);
  if (!applied) return db;
  const sortOrder = sortKeyForStatus(db, applied.folder.id, applied.statusId);
  db = mapItem(db, item.id, (row) => ({
    ...row,
    folderId: applied.folder.id,
    statusId: applied.statusId,
    store: rule.actionStore ?? row.store,
    sortOrder,
    updatedAt: ctx.now,
  }));
  if (rule.actionTagId && !tagIds.includes(rule.actionTagId) && byId(db.tags, rule.actionTagId)) {
    db = {
      ...db,
      itemTags: [
        ...db.itemTags,
        {
          id: ctx.id(),
          workspaceId: workspaceId(db),
          itemId: item.id,
          tagId: rule.actionTagId,
          isDeleted: false,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        },
      ],
    };
  }
  return db;
}

function sortInbox(db: Db, ctx: Ctx): Db {
  const inbox = inboxFolder(db);
  if (!inbox) return db;
  for (const item of alive(db.items)) {
    if (item.folderId !== inbox.id) continue;
    db = fileInboxItem(db, item.id, ctx);
  }
  return db;
}

function emptyTrash(db: Db): Db {
  const keep = <T extends { isDeleted: boolean }>(rows: T[]) => rows.filter((row) => !row.isDeleted);
  const items = keep(db.items);
  const itemIds = new Set(items.map((item) => item.id));
  const tags = keep(db.tags);
  const tagIds = new Set(tags.map((tag) => tag.id));
  const folders = keep(db.folders);
  const folderIds = new Set(folders.map((folder) => folder.id));
  return {
    ...db,
    workspaces: keep(db.workspaces),
    folders,
    statuses: keep(db.statuses).filter((status) => folderIds.has(status.folderId)),
    items,
    tags,
    people: keep(db.people),
    itemTags: keep(db.itemTags).filter((link) => itemIds.has(link.itemId) && tagIds.has(link.tagId)),
    dependencies: keep(db.dependencies).filter((row) => itemIds.has(row.itemId) && itemIds.has(row.dependsOnId)),
    itemLinks: keep(db.itemLinks).filter((link) => itemIds.has(link.fromId) && itemIds.has(link.toId)),
    shoppingTemplates: keep(db.shoppingTemplates),
    savedViews: keep(db.savedViews),
    rules: keep(db.rules).filter((rule) => folderIds.has(rule.actionFolderId)),
  };
}

function mapItem(db: Db, id: string, recipe: (item: Item) => Item): Db {
  if (!db.items.some((item) => item.id === id)) return db;
  return { ...db, items: db.items.map((item) => (item.id === id ? recipe(item) : item)) };
}

function mapTag(db: Db, id: string, recipe: (tag: Db["tags"][number]) => Db["tags"][number]): Db {
  return { ...db, tags: db.tags.map((tag) => (tag.id === id ? recipe(tag) : tag)) };
}

function mapPerson(db: Db, id: string, recipe: (person: Db["people"][number]) => Db["people"][number]): Db {
  return { ...db, people: db.people.map((person) => (person.id === id ? recipe(person) : person)) };
}

function mapDependency(db: Db, id: string, recipe: (row: Db["dependencies"][number]) => Db["dependencies"][number]): Db {
  return { ...db, dependencies: db.dependencies.map((row) => (row.id === id ? recipe(row) : row)) };
}
