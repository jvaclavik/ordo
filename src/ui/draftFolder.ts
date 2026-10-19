import { useSyncExternalStore } from "react";
import { undo } from "../data/store.tsx";

type Entry = {
  active: () => boolean;
  clear: () => void;
};

const entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerDraftFolderUndo(
  active: () => boolean,
  clear: () => void
) {
  const entry = { active, clear };
  entries.push(entry);
  emit();
  return () => {
    const index = entries.lastIndexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    emit();
  };
}

export function draftFolderActive() {
  return entries.some((entry) => entry.active());
}

export function undoDraftFolder() {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry?.active()) continue;
    entry.clear();
    return true;
  }
  return false;
}

export function revertLast() {
  if (undoDraftFolder()) return;
  undo();
}

export function useDraftFolder() {
  return useSyncExternalStore(subscribe, draftFolderActive, () => false);
}
