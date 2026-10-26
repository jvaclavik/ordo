import { storedAmount, storedSymbol } from "./dictate.ts";
import { storedPlace } from "./place.ts";
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
  place?: string | null;
  origin?: string | null;
  spot?: string | null;
  amount?: string | null;
  variableSymbol?: string | null;
  parentItemId?: string | null;
  applyRules?: boolean;
  tagIds?: string[];
  paper?: number | null;
  pinX?: number | null;
  pinY?: number | null;
  pinZ?: number | null;
  pinW?: number | null;
  pinH?: number | null;
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
    place: storedPlace(init.place),
    origin: storedPlace(init.origin),
    spot: storedPlace(init.spot),
    amount: storedAmount(init.amount),
    variableSymbol: storedSymbol(init.variableSymbol),
    parentItemId: init.parentItemId ?? null,
    applyRules: init.applyRules ?? true,
    tagIds: init.tagIds ?? [],
    paper: init.paper ?? null,
    pinX: init.pinX ?? null,
    pinY: init.pinY ?? null,
    pinZ: init.pinZ ?? null,
    pinW: init.pinW ?? null,
    pinH: init.pinH ?? null,
  };
}
