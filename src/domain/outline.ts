import { byOrder, keyAtEnd, keyBetween } from "./ordering.ts";

export type OutlineNode = {
  id: string;
  parentItemId: string | null;
  sortOrder: string;
  folderId: string;
};

export type OutlinePatch = {
  id: string;
  parentItemId: string | null;
  sortOrder: string;
};

export function nestOutline<T extends OutlineNode>(items: T[]): { item: T; depth: number }[] {
  const known = new Set(items.map((item) => item.id));
  const children = new Map<string, T[]>();
  const childIds = new Set<string>();
  for (const item of items) {
    const parentId = item.parentItemId;
    if (!parentId || parentId === item.id || !known.has(parentId)) continue;
    const list = children.get(parentId) ?? [];
    list.push(item);
    children.set(parentId, list);
    childIds.add(item.id);
  }
  for (const list of children.values()) list.sort(byOrder);
  const rows: { item: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (item: T, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    rows.push({ item, depth });
    for (const child of children.get(item.id) ?? []) walk(child, depth + 1);
  };
  for (const item of items) {
    if (!childIds.has(item.id)) walk(item, 0);
  }
  for (const item of items) {
    if (!seen.has(item.id)) walk(item, 0);
  }
  return rows;
}

function peers(pool: OutlineNode[], folderId: string, parentId: string | null) {
  return pool
    .filter(
      (item) => item.folderId === folderId && (item.parentItemId ?? null) === parentId
    )
    .sort(byOrder);
}

export function indentOutline(
  visible: OutlineNode[],
  pool: OutlineNode[],
  id: string,
): OutlinePatch[] {
  const rows = nestOutline(visible);
  const index = rows.findIndex((row) => row.item.id === id);
  if (index < 0) return [];
  const depth = rows[index]!.depth;
  const item = rows[index]!.item;
  let sibling: OutlineNode | null = null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const row = rows[cursor]!;
    if (row.depth < depth) break;
    if (row.depth === depth) {
      sibling = row.item;
      break;
    }
  }
  if (!sibling || sibling.folderId !== item.folderId) return [];
  const keys = pool
    .filter((entry) => entry.parentItemId === sibling.id)
    .map((entry) => entry.sortOrder);
  return [{ id, parentItemId: sibling.id, sortOrder: keyAtEnd(keys) }];
}

export function outdentOutline(
  visible: OutlineNode[],
  pool: OutlineNode[],
  id: string,
): OutlinePatch[] {
  const rows = nestOutline(visible);
  const index = rows.findIndex((row) => row.item.id === id);
  if (index < 0) return [];
  const row = rows[index]!;
  if (row.depth === 0) return [];
  const item = row.item;
  const parent = pool.find((entry) => entry.id === item.parentItemId) ?? null;
  if (!parent) return [];
  const grandparent = parent.parentItemId;
  const ordered = peers(pool, item.folderId, grandparent).filter(
    (entry) => entry.id !== item.id
  );
  const sortOrder =
    parent.folderId === item.folderId
      ? keyBetween(
          parent.sortOrder || null,
          ordered.find((entry) => entry.sortOrder > parent.sortOrder)?.sortOrder ?? null
        )
      : keyAtEnd(ordered.map((entry) => entry.sortOrder));
  const following: OutlineNode[] = [];
  for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
    const next = rows[cursor]!;
    if (next.depth < row.depth) break;
    if (next.depth !== row.depth) continue;
    if (next.item.folderId !== item.folderId) break;
    following.push(next.item);
  }
  let keys = pool
    .filter((entry) => entry.parentItemId === item.id)
    .map((entry) => entry.sortOrder);
  const adopted = following.map((entry) => {
    const nextKey = keyAtEnd(keys);
    keys = [...keys, nextKey];
    return { id: entry.id, parentItemId: item.id, sortOrder: nextKey };
  });
  return [{ id: item.id, parentItemId: grandparent, sortOrder }, ...adopted];
}
