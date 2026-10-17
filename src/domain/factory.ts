import type { ItemType, NewItem, Priority } from "./types.ts";

export function newItem(init: {
  id: string;
  folderId: string;
  title: string;
  sortOrder?: string;
  type?: ItemType;
  body?: string | null;
  statusId?: string | null;
  priority?: Priority | null;
  assigneeId?: string | null;
  dueAt?: string | null;
  dueHasTime?: boolean;
  plannedFor?: string | null;
  planUntil?: string | null;
  store?: string | null;
  quantity?: string | null;
  unit?: string | null;
  spec?: string | null;
  templateId?: string | null;
  parentItemId?: string | null;
  applyRules?: boolean;
  tagIds?: string[];
}): NewItem {
  return {
    id: init.id,
    folderId: init.folderId,
    title: init.title.trim(),
    sortOrder: init.sortOrder ?? "",
    type: init.type ?? "task",
    body: init.body ?? null,
    statusId: init.statusId ?? null,
    priority: init.priority ?? null,
    assigneeId: init.assigneeId ?? null,
    dueAt: init.dueAt ?? null,
    dueHasTime: init.dueHasTime ?? false,
    plannedFor: init.plannedFor ?? null,
    planUntil: init.planUntil ?? null,
    store: init.store ?? null,
    quantity: init.quantity ?? null,
    unit: init.unit ?? null,
    spec: init.spec ?? null,
    templateId: init.templateId ?? null,
    parentItemId: init.parentItemId ?? null,
    applyRules: init.applyRules ?? true,
    tagIds: init.tagIds ?? [],
  };
}
