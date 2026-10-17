import { createContext, useContext } from "react";

export type FolderDropIntent = "before" | "after" | "inside";

export type FolderDragState = {
  targetId: string | null;
  intent: FolderDropIntent;
  scope: string | null;
};

export const FolderDragContext = createContext<FolderDragState>({
  targetId: null,
  intent: "before",
  scope: null,
});

export function folderDropLabel(
  intent: FolderDropIntent,
  targetName: string,
  parentName: string | null,
): string {
  if (intent === "inside") return `Do složky ${targetName}`;
  if (parentName) return `Ve složce ${parentName}`;
  return "Na nejvyšší úrovni";
}

export function useFolderDrag() {
  return useContext(FolderDragContext);
}

export type FolderRowBox = { id: string; top: number; height: number };

export function folderDropIntent(
  pointerY: number | null,
  top: number,
  height: number,
  nest: boolean,
  previous: FolderDropIntent | null = null,
): FolderDropIntent {
  if (nest) return "inside";
  if (pointerY === null || height <= 0) return previous ?? "before";
  const ratio = (pointerY - top) / height;
  if (previous === "before" && ratio < 0.45) return "before";
  if (previous === "after" && ratio > 0.55) return "after";
  if (previous === "inside" && ratio >= 0.12 && ratio <= 0.88) return "inside";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

export function folderHit(
  rows: FolderRowBox[],
  pointerY: number,
  draggedId: string | null,
  nest: boolean,
  previous: { id: string; intent: FolderDropIntent } | null = null,
): { id: string; intent: FolderDropIntent } | null {
  const row = rows.find(
    (entry) => entry.id !== draggedId && pointerY >= entry.top && pointerY < entry.top + entry.height,
  );
  if (!row) return null;
  const prior = previous?.id === row.id ? previous.intent : null;
  return { id: row.id, intent: folderDropIntent(pointerY, row.top, row.height, nest, prior) };
}

export function settleIntent(
  intent: FolderDropIntent,
  insideOk: boolean,
  besideOk: boolean,
  ratio: number,
): FolderDropIntent | null {
  if (intent === "inside") {
    if (insideOk) return "inside";
    if (!besideOk) return null;
    return ratio < 0.5 ? "before" : "after";
  }
  if (besideOk) return intent;
  return insideOk ? "inside" : null;
}

export function pointerClient(event: Event, deltaX: number, deltaY: number): { x: number; y: number } | null {
  if (event instanceof MouseEvent) return { x: event.clientX + deltaX, y: event.clientY + deltaY };
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    return touch ? { x: touch.clientX + deltaX, y: touch.clientY + deltaY } : null;
  }
  return null;
}

export function pointerClientY(event: Event, deltaY: number): number | null {
  return pointerClient(event, 0, deltaY)?.y ?? null;
}
