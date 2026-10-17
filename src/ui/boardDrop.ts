import { createContext, useContext } from "react";

export type BoardSlot = { statusId: string; beforeId: string | null };

export const BoardSlotContext = createContext<BoardSlot | null>(null);

export function useBoardSlot() {
  return useContext(BoardSlotContext);
}

export type BoxSpan = { top: number; height: number };

export function undoDragShift(
  top: number,
  source: BoxSpan | null,
  gap: BoxSpan | null
): number {
  let next = top;
  if (source && top >= source.top - 1) next += source.height;
  if (gap && top >= gap.top - 1) next -= gap.height;
  return next;
}

export type CardBox = { id: string; top: number; height: number };

export type BoardDrop = {
  folderId: string;
  statusId: string;
  beforeId: string | null;
};

export function boardSlot(
  cards: CardBox[],
  pointerY: number,
  activeId: string | null,
  previous?: string | null
): string | null {
  const rows = cards.filter((card) => card.id !== activeId && card.height > 0);
  const hit = rows.find(
    (card) => pointerY >= card.top && pointerY < card.top + card.height
  );
  if (!hit) {
    for (const card of rows) {
      if (pointerY < card.top + card.height / 2) return card.id;
    }
    return null;
  }
  const ratio = (pointerY - hit.top) / hit.height;
  const index = rows.findIndex((card) => card.id === hit.id);
  const beforeId = hit.id;
  const afterId = rows[index + 1]?.id ?? null;
  if (previous !== undefined && previous === beforeId && ratio < 0.45)
    return beforeId;
  if (previous !== undefined && previous === afterId && ratio > 0.55)
    return afterId;
  if (ratio < 0.25) return beforeId;
  if (ratio > 0.75) return afterId;
  return ratio < 0.5 ? beforeId : afterId;
}

export function slotChanges(
  ids: string[],
  activeId: string,
  beforeId: string | null
): boolean {
  if (!ids.includes(activeId)) return true;
  const rest = ids.filter((id) => id !== activeId);
  const index = beforeId === null ? rest.length : rest.indexOf(beforeId);
  const at = index < 0 ? rest.length : index;
  const next = [...rest];
  next.splice(at, 0, activeId);
  return next.some((id, position) => id !== ids[position]);
}

export function boardDropAt(
  root: ParentNode,
  x: number,
  y: number,
  activeId: string,
  previous?: string | null,
  bias?: { source: BoxSpan | null; gap: BoxSpan | null }
): BoardDrop | null {
  const columns = root.querySelectorAll<HTMLElement>("[data-board-status]");
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue;
    const folderId = column.dataset.boardFolder;
    const statusId = column.dataset.boardStatus;
    if (!folderId || !statusId) return null;
    const cards = [
      ...column.querySelectorAll<HTMLElement>("[data-task-id]"),
    ].flatMap((node) => {
      const id = node.dataset.taskId;
      if (!id) return [];
      const box = node.getBoundingClientRect();
      if (box.height < 1) return [];
      return [
        {
          id,
          top: undoDragShift(box.top, bias?.source ?? null, bias?.gap ?? null),
          height: box.height,
        },
      ];
    });
    return {
      folderId,
      statusId,
      beforeId: boardSlot(cards, y, activeId, previous),
    };
  }
  return null;
}
