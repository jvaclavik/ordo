import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { dispatch, useSnap } from "../data/store.tsx";
import { addDays, todayKey } from "../domain/dates.ts";
import { alive, byId, wouldFolderCycle } from "../domain/db.ts";
import type { Op } from "../domain/op.ts";
import { keyAtEnd, keyAtIndex, keyAtStart } from "../domain/ordering.ts";
import { childFolders, mapStatus, tagsOf } from "../domain/select.ts";
import type { StatusMeaning } from "../domain/types.ts";
import {
  BoardSlotContext,
  boardDropAt,
  slotChanges,
  undoDragShift,
  type BoardDrop,
  type BoardSlot,
  type BoxSpan,
} from "./boardDrop.ts";
import {
  FolderDragContext,
  folderDropLabel,
  folderHit,
  pointerClient,
  settleIntent,
  type FolderDragState,
  type FolderDropIntent,
  type FolderRowBox,
} from "./folderDrop.ts";
import { Dot } from "./folders.tsx";
import { placeMany, placeOp, statusForMeaning } from "./move.ts";
import { useUi } from "./state.tsx";
import { dayMoveIds, dayOrderOps } from "./calendar.tsx";
import { deleteItems } from "./tasks.tsx";

const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const found = hits.length > 0 ? hits : closestCenter(args);
  const rank = (id: string) => {
    if (id.startsWith("item:")) return 0;
    if (id.startsWith("status:")) return 1;
    if (id.startsWith("meaning:")) return 2;
    if (id.startsWith("plan:")) return 3;
    return 4;
  };
  return [...found].sort(
    (left, right) => rank(String(left.id)) - rank(String(right.id))
  );
};

function taskFolderId(overId: string): string | null {
  if (overId.startsWith("page-folder-drop:"))
    return overId.slice("page-folder-drop:".length) || null;
  if (overId.startsWith("crumb-drop:")) {
    const rest = overId.slice("crumb-drop:".length);
    const split = rest.indexOf(":");
    if (split < 0) return null;
    return rest.slice(split + 1) || null;
  }
  if (overId.startsWith("folder-drop:") && overId !== "folder-drop:root")
    return overId.slice("folder-drop:".length) || null;
  return null;
}

type Ghost =
  | {
      kind: "folder";
      name: string;
      color: string | null;
      icon: string | null;
      x: number;
      y: number;
    }
  | { kind: "item"; title: string; width: number };

function marginBox(node: HTMLElement): BoxSpan {
  const box = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  return {
    top: box.top - marginTop,
    height: box.height + marginTop + marginBottom,
  };
}

function gapBox(selector: string): BoxSpan | null {
  const gap = document.querySelector<HTMLElement>(selector);
  return gap ? marginBox(gap) : null;
}

function folderRowBoxes(
  root: ParentNode,
  source: BoxSpan | null,
  gap: BoxSpan | null
): FolderRowBox[] {
  return [...root.querySelectorAll<HTMLElement>("[data-folder-row]")].flatMap(
    (node) => {
      const id = node.dataset.folderRow;
      if (!id) return [];
      const box = node.getBoundingClientRect();
      if (box.height < 1) return [];
      return [
        {
          id,
          top: undoDragShift(box.top, source, gap),
          height: box.height,
        },
      ];
    }
  );
}

function treeAt(pointer: { x: number; y: number }) {
  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const node of document.querySelectorAll<HTMLElement>(
    "[data-folder-tree]"
  )) {
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    if (
      pointer.x < box.left ||
      pointer.x > box.right ||
      pointer.y < box.top ||
      pointer.y > box.bottom
    ) {
      continue;
    }
    const area = box.width * box.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

function folderCaption(
  folders: { id: string; name: string; parentId: string | null }[],
  drag: FolderDragState
): string | null {
  if (!drag.targetId) return null;
  if (drag.targetId === "root") return "Na nejvyšší úrovni";
  const target = byId(folders, drag.targetId);
  if (!target) return null;
  const parent = byId(folders, target.parentId);
  return folderDropLabel(drag.intent, target.name, parent?.name ?? null);
}

function pointerOverColumn(pointer: { x: number; y: number }) {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-board-status]"),
  ].some((node) => {
    const box = node.getBoundingClientRect();
    return (
      pointer.x >= box.left &&
      pointer.x <= box.right &&
      pointer.y >= box.top &&
      pointer.y <= box.bottom
    );
  });
}

function pointerIn(pointer: { x: number; y: number }, selector: string) {
  const node = document.querySelector(selector);
  if (!node) return false;
  const box = node.getBoundingClientRect();
  return (
    pointer.x >= box.left &&
    pointer.x <= box.right &&
    pointer.y >= box.top &&
    pointer.y <= box.bottom
  );
}

export function DragLayer({ children }: { children: ReactNode }) {
  const { db } = useSnap();
  const ui = useUi();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [itemLabel, setItemLabel] = useState<string | null>(null);
  const itemLabelKey = useRef("");
  const [boardSlot, setBoardSlot] = useState<BoardSlot | null>(null);
  const boardSlotKey = useRef<string | null>(null);
  const boardBefore = useRef<string | null | undefined>(undefined);
  const boardDropRef = useRef<BoardDrop | null>(null);
  const sourceSpanRef = useRef<BoxSpan | null>(null);
  const [folderDrag, setFolderDrag] = useState<FolderDragState>({
    targetId: null,
    intent: "before",
    scope: null,
  });
  const nestRef = useRef(false);
  const placeRef = useRef<{
    targetId: string;
    intent: FolderDropIntent;
    scope: string | null;
  } | null>(null);
  const shownRef = useRef("");
  const draggedRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const showFolder = (
    targetId: string | null,
    intent: FolderDropIntent,
    scope: string | null
  ) => {
    placeRef.current = targetId ? { targetId, intent, scope } : null;
    const key = `${scope ?? ""}:${targetId ?? ""}:${targetId ? intent : ""}`;
    if (shownRef.current === key) return;
    shownRef.current = key;
    setFolderDrag({ targetId, intent, scope });
  };
  const aimFolder = (
    pointer: { x: number; y: number },
    draggedId: string,
    nest: boolean
  ) => {
    if (pointerIn(pointer, "[data-folder-root]")) {
      showFolder("root", "inside", "side");
      return placeRef.current;
    }
    const tree = treeAt(pointer);
    if (!tree) {
      showFolder(null, "before", null);
      return null;
    }
    const scope = tree.dataset.folderScope ?? null;
    const dragging = tree.querySelector<HTMLElement>("[data-folder-dragging]");
    const draggedRow = dragging?.querySelector<HTMLElement>(
      "[data-folder-row]"
    );
    const collapsed = dragging
      ? (draggedRow?.getBoundingClientRect().height ?? 0) < 1
      : false;
    const gapNode = tree.querySelector<HTMLElement>("[data-folder-gap]");
    const rows = folderRowBoxes(
      tree,
      collapsed ? sourceSpanRef.current : null,
      gapNode ? marginBox(gapNode) : null
    );
    const previous =
      placeRef.current?.scope === scope
        ? { id: placeRef.current.targetId, intent: placeRef.current.intent }
        : null;
    const hit = folderHit(rows, pointer.y, draggedId, nest, previous);
    if (!hit) {
      if (placeRef.current?.scope === scope) return placeRef.current;
      showFolder(null, "before", null);
      return null;
    }
    const row = rows.find((entry) => entry.id === hit.id);
    const target = byId(db.folders, hit.id);
    if (!row || !target) return placeRef.current;
    const ratio = row.height > 0 ? (pointer.y - row.top) / row.height : 0;
    const intent = settleIntent(
      hit.intent,
      !wouldFolderCycle(db, draggedId, hit.id),
      !wouldFolderCycle(db, draggedId, target.parentId),
      ratio
    );
    if (!intent) {
      showFolder(null, "before", null);
      return null;
    }
    showFolder(hit.id, intent, scope);
    return placeRef.current;
  };
  const aimRef = useRef(aimFolder);
  aimRef.current = aimFolder;
  useEffect(() => {
    const sync = (event: KeyboardEvent, down: boolean) => {
      if (event.key !== "Alt") return;
      nestRef.current = down;
      const pointer = pointerRef.current;
      const draggedId = draggedRef.current;
      if (!pointer || !draggedId) return;
      aimRef.current(pointer, draggedId, down);
    };
    const down = (event: KeyboardEvent) => sync(event, true);
    const up = (event: KeyboardEvent) => sync(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  const trackFolder = (event: DragMoveEvent | DragEndEvent) => {
    const data = event.active.data.current as
      | { kind?: string; folderId?: string }
      | undefined;
    if (data?.kind !== "folder" || !data.folderId) {
      draggedRef.current = null;
      showFolder(null, "before", null);
      return null;
    }
    draggedRef.current = data.folderId;
    const pointer = pointerClient(
      event.activatorEvent,
      event.delta.x,
      event.delta.y
    );
    pointerRef.current = pointer;
    const overId = event.over ? String(event.over.id) : null;
    if (!pointer) {
      if (overId === "folder-drop:root") showFolder("root", "inside", "side");
      return placeRef.current;
    }
    return aimFolder(pointer, data.folderId, nestRef.current);
  };

  const trackBoard = (event: DragMoveEvent | DragEndEvent) => {
    const data = event.active.data.current as
      | { kind?: string; itemId?: string }
      | undefined;
    if (data?.kind !== "item" || !data.itemId) {
      if (boardSlotKey.current !== null || boardDropRef.current) {
        boardSlotKey.current = null;
        boardBefore.current = undefined;
        boardDropRef.current = null;
        setBoardSlot(null);
      }
      return null;
    }
    const point = pointerClient(
      event.activatorEvent,
      event.delta.x,
      event.delta.y
    );
    if (!point) return null;
    const card = document.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(data.itemId)}"]`
    );
    const collapsed = (card?.getBoundingClientRect().height ?? 1) < 1;
    const drop = boardDropAt(
      document,
      point.x,
      point.y,
      data.itemId,
      boardBefore.current,
      {
        source: collapsed ? sourceSpanRef.current : null,
        gap: gapBox("[data-board-gap]"),
      }
    );
    boardDropRef.current = drop;
    boardBefore.current = drop ? drop.beforeId : undefined;
    const key = drop ? `${drop.statusId}:${drop.beforeId ?? ""}` : "";
    if (boardSlotKey.current !== key) {
      boardSlotKey.current = key;
      setBoardSlot(
        drop ? { statusId: drop.statusId, beforeId: drop.beforeId } : null
      );
    }
    return drop;
  };

  const trackItem = (event: DragMoveEvent | DragEndEvent) => {
    const data = event.active.data.current as { kind?: string } | undefined;
    const overId = event.over ? String(event.over.id) : null;
    const folderId =
      data?.kind === "item" && overId ? taskFolderId(overId) : null;
    const name = folderId ? byId(db.folders, folderId)?.name ?? null : null;
    const label =
      overId === "trash" ? "Do koše" : name ? `Do složky ${name}` : "";
    if (itemLabelKey.current === label) return;
    itemLabelKey.current = label;
    setItemLabel(label || null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setGhost(null);
    itemLabelKey.current = "";
    setItemLabel(null);
    const data = event.active.data.current as
      | {
          kind?: string;
          itemId?: string;
          folderId?: string;
          calendarDay?: string;
        }
      | undefined;
    const overId = event.over ? String(event.over.id) : null;
    const pointer = pointerClient(
      event.activatorEvent,
      event.delta.x,
      event.delta.y
    );
    const folderPlace =
      data?.kind === "folder" &&
      pointer &&
      (treeAt(pointer) || pointerIn(pointer, "[data-folder-root]"))
        ? placeRef.current
        : null;
    const board =
      data?.kind === "item" && pointer && pointerOverColumn(pointer)
        ? boardDropRef.current
        : null;
    boardSlotKey.current = null;
    boardBefore.current = undefined;
    boardDropRef.current = null;
    sourceSpanRef.current = null;
    setBoardSlot(null);
    placeRef.current = null;
    shownRef.current = "";
    draggedRef.current = null;
    pointerRef.current = null;
    setFolderDrag({ targetId: null, intent: "before", scope: null });
    if (!data) return;
    if (data.kind === "folder" && data.folderId && folderPlace) {
      moveFolder(data.folderId, folderPlace.targetId, folderPlace.intent);
      return;
    }
    if (data.kind === "item" && data.itemId) {
      if (board) {
        dropOnBoard(data.itemId, board);
        return;
      }
      if (overId) moveItem(data.itemId, overId, data.calendarDay);
    }
  };

  const selectionOf = (itemId: string) =>
    ui.picked.length > 1 && ui.picked.includes(itemId) ? ui.picked : [itemId];

  const finishMove = (ids: string[], ops: Op[]) => {
    const op =
      ops.length === 1
        ? ops[0]
        : ops.length > 1
        ? { type: "batch" as const, ops }
        : null;
    if (!op) return;
    dispatch(op);
    if (ids.length > 1) ui.clearPicked();
  };

  const moveFolder = (
    folderId: string,
    targetId: string,
    intent: FolderDropIntent
  ) => {
    const folder = byId(db.folders, folderId);
    if (!folder || folder.system === "inbox") return;
    if (targetId === "root") {
      const keys = childFolders(db, null)
        .filter((entry) => entry.id !== folderId)
        .map((entry) => entry.sortOrder);
      dispatch({
        type: "moveFolder",
        id: folderId,
        parentId: null,
        sortOrder: keyAtEnd(keys),
      });
      return;
    }
    if (targetId === folderId) return;
    const target = byId(db.folders, targetId);
    if (!target) return;
    if (intent === "inside") {
      if (wouldFolderCycle(db, folderId, targetId)) return;
      const keys = childFolders(db, targetId)
        .filter((entry) => entry.id !== folderId)
        .map((entry) => entry.sortOrder);
      dispatch({
        type: "moveFolder",
        id: folderId,
        parentId: targetId,
        sortOrder: keyAtStart(keys),
      });
      return;
    }
    if (wouldFolderCycle(db, folderId, target.parentId)) return;
    const siblings = childFolders(db, target.parentId).filter(
      (entry) => entry.id !== folderId
    );
    const index = siblings.findIndex((entry) => entry.id === target.id);
    const at =
      index < 0 ? siblings.length : intent === "before" ? index : index + 1;
    dispatch({
      type: "moveFolder",
      id: folderId,
      parentId: target.parentId,
      sortOrder: keyAtIndex(
        siblings.map((entry) => entry.sortOrder),
        at
      ),
    });
  };

  const dropOnBoard = (itemId: string, drop: BoardDrop) => {
    const ids = selectionOf(itemId);
    const before = drop.beforeId ?? undefined;
    if (ids.length === 1) {
      const item = byId(db.items, itemId);
      if (!item) return;
      if (item.folderId === drop.folderId && item.statusId === drop.statusId) {
        const column = alive(db.items)
          .filter(
            (entry) =>
              entry.folderId === drop.folderId &&
              entry.statusId === drop.statusId
          )
          .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
        if (
          !slotChanges(
            column.map((entry) => entry.id),
            itemId,
            drop.beforeId
          )
        )
          return;
      }
      dispatch(
        before
          ? placeOp(db, itemId, drop.folderId, drop.statusId, before, true)
          : placeOp(db, itemId, drop.folderId, drop.statusId, undefined, true)
      );
      return;
    }
    finishMove(
      ids,
      before
        ? placeMany(db, ids, drop.folderId, drop.statusId, before, true)
        : placeMany(db, ids, drop.folderId, drop.statusId, undefined, true)
    );
  };

  const moveItem = (itemId: string, overId: string, calendarDay?: string) => {
    const ids = selectionOf(itemId);
    if (overId === "trash") {
      const rows = ids.flatMap((id) => {
        const row = byId(db.items, id);
        return row && !row.isDeleted ? [row] : [];
      });
      deleteItems(rows, ui.pushToast, () => {
        if (ui.selectedId && ids.includes(ui.selectedId)) ui.setSelected(null);
        if (rows.length > 1) ui.clearPicked();
      });
      return;
    }
    if (calendarDay && ids.length === 1 && overId.startsWith("item:")) {
      const beforeId = overId.slice("item:".length);
      const listed = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-calendar-list] [data-task-id]"
        ),
      ].flatMap((row) => (row.dataset.taskId ? [row.dataset.taskId] : []));
      if (listed.includes(itemId) && listed.includes(beforeId)) {
        const next = dayMoveIds(listed, itemId, beforeId);
        if (next) dispatch({ type: "batch", ops: dayOrderOps(next) });
        return;
      }
    }
    if (ids.length > 1) {
      moveMany(ids, overId);
      return;
    }
    moveOne(itemId, overId);
  };

  const moveMany = (ids: string[], overId: string) => {
    if (overId.startsWith("item:")) {
      const target = byId(db.items, overId.slice("item:".length));
      if (!target?.statusId) return;
      const moving = ids.filter((id) => id !== target.id);
      finishMove(
        ids,
        placeMany(db, moving, target.folderId, target.statusId, target.id, true)
      );
      return;
    }
    if (overId.startsWith("status:")) {
      const status = byId(db.statuses, overId.slice("status:".length));
      if (!status) return;
      finishMove(ids, placeMany(db, ids, status.folderId, status.id, undefined, true));
      return;
    }
    const manyFolder = taskFolderId(overId);
    if (manyFolder) {
      const folderId = manyFolder;
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const item = byId(db.items, id);
        if (!item) continue;
        const mapped = mapStatus(db, item.statusId, folderId);
        const statusId = mapped.statusId ?? mapped.choices[0]?.id;
        if (!statusId) continue;
        groups.set(statusId, [...(groups.get(statusId) ?? []), id]);
      }
      finishMove(
        ids,
        [...groups].flatMap(([statusId, group]) =>
          placeMany(db, group, folderId, statusId)
        )
      );
      return;
    }
    if (overId.startsWith("plan:")) {
      const token = overId.slice("plan:".length);
      const today = todayKey();
      const day =
        token === "today"
          ? today
          : token === "tomorrow"
          ? addDays(today, 1)
          : token;
      finishMove(
        ids,
        ids.map((id) => ({
          type: "updateItem",
          id,
          patch: { plannedFor: day, planUntil: null, dueAt: null, dueHasTime: false },
        }))
      );
      return;
    }
    if (overId.startsWith("person:")) {
      const assigneeId = overId.slice("person:".length);
      finishMove(
        ids,
        ids.map((id) => ({ type: "updateItem", id, patch: { assigneeId } }))
      );
      return;
    }
    if (overId.startsWith("tag:")) {
      const tagId = overId.slice("tag:".length);
      const ops = ids.flatMap((id) => {
        const current = tagsOf(db, id).map((tag) => tag.id);
        if (current.includes(tagId)) return [];
        return [
          {
            type: "setItemTags" as const,
            itemId: id,
            tagIds: [...current, tagId],
          },
        ];
      });
      finishMove(ids, ops);
      return;
    }
    if (overId.startsWith("meaning:")) {
      const meaning = overId.slice("meaning:".length) as StatusMeaning;
      const folders = new Map<string, string[]>();
      for (const id of ids) {
        const item = byId(db.items, id);
        if (!item) continue;
        folders.set(item.folderId, [...(folders.get(item.folderId) ?? []), id]);
      }
      const go = (folderId: string, group: string[], statusId: string) =>
        finishMove(ids, placeMany(db, group, folderId, statusId));
      if (folders.size === 1) {
        const entry = [...folders][0];
        if (!entry) return;
        const [folderId, group] = entry;
        const options = statusForMeaning(db, folderId, meaning);
        if (options.length === 1 && options[0])
          go(folderId, group, options[0].id);
        else if (options.length > 1) {
          ui.askChoice({
            title: "Který stav?",
            options: options.map((status) => ({
              id: status.id,
              label: status.name,
            })),
            onPick: (statusId) => go(folderId, group, statusId),
          });
        }
        return;
      }
      const ops = [...folders].flatMap(([folderId, group]) => {
        const status = statusForMeaning(db, folderId, meaning)[0];
        return status ? placeMany(db, group, folderId, status.id) : [];
      });
      finishMove(ids, ops);
    }
  };

  const moveOne = (itemId: string, overId: string) => {
    const item = byId(db.items, itemId);
    if (!item) return;
    if (overId.startsWith("item:")) {
      const target = byId(db.items, overId.slice("item:".length));
      if (!target || target.id === item.id || !target.statusId) return;
      dispatch(
        placeOp(db, item.id, target.folderId, target.statusId, target.id, true)
      );
      return;
    }
    if (overId.startsWith("status:")) {
      const status = byId(db.statuses, overId.slice("status:".length));
      if (!status) return;
      dispatch(placeOp(db, item.id, status.folderId, status.id, undefined, true));
      return;
    }
    const oneFolder = taskFolderId(overId);
    if (oneFolder) {
      const folderId = oneFolder;
      const mapped = placeByMeaning(item.id, item.statusId, folderId);
      if (mapped) return;
    }
    if (overId.startsWith("plan:")) {
      const token = overId.slice("plan:".length);
      const today = todayKey();
      const day =
        token === "today"
          ? today
          : token === "tomorrow"
          ? addDays(today, 1)
          : token;
      dispatch({
        type: "updateItem",
        id: item.id,
        patch: { plannedFor: day, planUntil: null, dueAt: null, dueHasTime: false },
      });
      return;
    }
    if (overId.startsWith("person:")) {
      dispatch({
        type: "updateItem",
        id: item.id,
        patch: { assigneeId: overId.slice("person:".length) },
      });
      return;
    }
    if (overId.startsWith("tag:")) {
      const tagId = overId.slice("tag:".length);
      const current = tagsOf(db, item.id).map((tag) => tag.id);
      if (!current.includes(tagId))
        dispatch({
          type: "setItemTags",
          itemId: item.id,
          tagIds: [...current, tagId],
        });
      return;
    }
    if (overId.startsWith("meaning:")) {
      const meaning = overId.slice("meaning:".length) as StatusMeaning;
      const options = statusForMeaning(db, item.folderId, meaning);
      const go = (statusId: string) =>
        dispatch(placeOp(db, item.id, item.folderId, statusId));
      if (options.length === 1 && options[0]) go(options[0].id);
      else if (options.length > 1)
        ui.askChoice({
          title: "Který stav?",
          options: options.map((status) => ({
            id: status.id,
            label: status.name,
          })),
          onPick: go,
        });
    }
  };

  const placeByMeaning = (
    itemId: string,
    statusId: string | null,
    folderId: string
  ) => {
    const item = byId(db.items, itemId);
    if (!item) return false;
    const mapped = mapStatus(db, statusId, folderId);
    const go = (nextStatus: string) =>
      dispatch(placeOp(db, item.id, folderId, nextStatus));
    if (mapped.choices.length > 1) {
      ui.askChoice({
        title: "Který stav?",
        options: mapped.choices.map((status) => ({
          id: status.id,
          label: status.name,
        })),
        onPick: go,
      });
      return true;
    }
    if (mapped.statusId) {
      go(mapped.statusId);
      return true;
    }
    return false;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      onDragStart={(event) => {
        const data = event.active.data.current as
          | { itemId?: string; folderId?: string }
          | undefined;
        const item = data?.itemId ? byId(db.items, data.itemId) : null;
        const folder = data?.folderId ? byId(db.folders, data.folderId) : null;
        const count =
          data?.itemId &&
          ui.picked.length > 1 &&
          ui.picked.includes(data.itemId)
            ? ui.picked.length
            : 0;
        let folderGrab = { x: 28, y: 18 };
        let itemWidth = 0;
        if (data?.folderId) {
          const origin = event.activatorEvent.target;
          const row =
            origin instanceof Element
              ? origin.closest<HTMLElement>("[data-folder-row]")
              : null;
          sourceSpanRef.current = row?.parentElement
            ? marginBox(row.parentElement)
            : null;
          const point = pointerClient(event.activatorEvent, 0, 0);
          if (row && point) {
            const box = row.getBoundingClientRect();
            folderGrab = { x: point.x - box.left, y: point.y - box.top };
          }
        } else if (data?.itemId) {
          const card = document.querySelector<HTMLElement>(
            `[data-task-id="${CSS.escape(data.itemId)}"]`
          );
          sourceSpanRef.current = card ? marginBox(card) : null;
          const title = card?.querySelector<HTMLElement>("span.block");
          const textWidth = title?.getBoundingClientRect().width ?? 0;
          itemWidth =
            textWidth > 0
              ? textWidth + 26
              : (card?.getBoundingClientRect().width ?? 0);
        } else {
          sourceSpanRef.current = null;
        }
        setGhost(
          folder
            ? {
                kind: "folder",
                name: folder.name,
                color: folder.color,
                icon: folder.icon,
                x: folderGrab.x,
                y: folderGrab.y,
              }
            : {
                kind: "item",
                title:
                  count > 1 ? `${count} vybraných` : item?.title ?? "Přesun",
                width: itemWidth > 0 ? itemWidth : 296,
              }
        );
      }}
      onDragOver={(event) => {
        trackFolder(event);
        trackBoard(event);
        trackItem(event);
      }}
      onDragMove={(event) => {
        trackFolder(event);
        trackBoard(event);
        trackItem(event);
      }}
      onDragCancel={() => {
        setGhost(null);
        itemLabelKey.current = "";
        setItemLabel(null);
        boardSlotKey.current = null;
        boardBefore.current = undefined;
        boardDropRef.current = null;
        sourceSpanRef.current = null;
        setBoardSlot(null);
        placeRef.current = null;
        shownRef.current = "";
        draggedRef.current = null;
        pointerRef.current = null;
        setFolderDrag({ targetId: null, intent: "before", scope: null });
      }}
      onDragEnd={onDragEnd}
    >
      <BoardSlotContext value={boardSlot}>
        <FolderDragContext value={folderDrag}>{children}</FolderDragContext>
      </BoardSlotContext>
      <DragOverlay
        dropAnimation={null}
        style={
          ghost?.kind === "item"
            ? { width: ghost.width, height: "auto" }
            : {}
        }
      >
        {ghost?.kind === "folder" && (
          <div className="pointer-events-none relative h-full w-full">
            <div
              className="absolute w-56"
              style={{
                left: ghost.x,
                top: ghost.y,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="flex h-9 items-center gap-3 rounded-md bg-panel px-3 shadow-[var(--shadow)] ring-1 ring-line">
                <Dot color={ghost.color} icon={ghost.icon} />
                <span className="truncate text-sm">{ghost.name}</span>
              </div>
              {folderCaption(db.folders, folderDrag) && (
                <div className="mt-1 w-max max-w-56 truncate rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-ink shadow-[var(--shadow)]">
                  {folderCaption(db.folders, folderDrag)}
                </div>
              )}
            </div>
          </div>
        )}
        {ghost?.kind === "item" && (
          <div className="pointer-events-none relative w-full">
            <div className="cursor-grabbing break-words whitespace-normal rounded-md border border-line bg-panel px-3 py-2.5 text-sm font-medium leading-5 opacity-70 shadow-[var(--shadow)]">
              {ghost.title}
            </div>
            {itemLabel && (
              <div className="absolute top-full left-0 mt-1 w-max max-w-56 truncate rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-ink shadow-[var(--shadow)]">
                {itemLabel}
              </div>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
