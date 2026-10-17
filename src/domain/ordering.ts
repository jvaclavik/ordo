import { generateKeyBetween } from "fractional-indexing";

export function byOrder<T extends { sortOrder: string }>(left: T, right: T): number {
  if (left.sortOrder < right.sortOrder) return -1;
  if (left.sortOrder > right.sortOrder) return 1;
  return 0;
}

export function sortedKeys(keys: string[]): string[] {
  return [...keys].filter((key) => key.length > 0).sort();
}

export function keyBetween(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next);
}

export function keyAtEnd(keys: string[]): string {
  const sorted = sortedKeys(keys);
  const last = sorted.length > 0 ? sorted[sorted.length - 1]! : null;
  return generateKeyBetween(last, null);
}

export function keyAtStart(keys: string[]): string {
  const sorted = sortedKeys(keys);
  const first = sorted.length > 0 ? sorted[0]! : null;
  return generateKeyBetween(null, first);
}

export function keyAtIndex(keys: string[], index: number): string {
  const sorted = sortedKeys(keys);
  const clamped = Math.max(0, Math.min(index, sorted.length));
  const prev = clamped > 0 ? sorted[clamped - 1]! : null;
  const next = clamped < sorted.length ? sorted[clamped]! : null;
  return generateKeyBetween(prev, next);
}
