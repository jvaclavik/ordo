import { emptyDb, withPlan } from "../domain/db.ts";
import type { Db } from "../domain/types.ts";

const collections = [
  ["workspace", "workspaces"],
  ["folder", "folders"],
  ["status", "statuses"],
  ["item", "items"],
  ["tag", "tags"],
  ["itemTag", "itemTags"],
  ["person", "people"],
  ["dependency", "dependencies"],
  ["itemLink", "itemLinks"],
  ["shoppingTemplate", "shoppingTemplates"],
  ["savedView", "savedViews"],
  ["rule", "rules"],
] as const;

type Kind = (typeof collections)[number][0];
type DbKey = (typeof collections)[number][1];

const keyOf = new Map<Kind, DbKey>(
  collections.map(([kind, key]) => [kind, key])
);

export type SyncRow = {
  kind: Kind;
  appId: string;
  payload: string;
  deleted: boolean;
};

function canonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonValue);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort())
    sorted[key] = canonValue(source[key]);
  return sorted;
}

export function canon(value: unknown): string {
  return JSON.stringify(canonValue(value));
}

export function rowsFromDb(db: Db): SyncRow[] {
  const rows: SyncRow[] = [];
  for (const [kind, key] of collections) {
    for (const entity of db[key]) {
      if (!entity || typeof entity.id !== "string") continue;
      rows.push({
        kind,
        appId: entity.id,
        payload: canon(entity),
        deleted: false,
      });
    }
  }
  return rows;
}

export function dbFromRows(rows: readonly SyncRow[]): Db | null {
  const db = emptyDb();
  for (const row of rows) {
    if (row.deleted) continue;
    const key = keyOf.get(row.kind);
    if (!key) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    )
      continue;
    (db[key] as unknown[]).push(parsed);
  }
  if (db.folders.length === 0 || db.workspaces.length === 0) return null;
  return withPlan(db);
}

export function fingerprint(db: Db): string {
  return rowsFromDb(db)
    .map((row) => `${row.kind}\n${row.appId}\n${row.payload}`)
    .sort()
    .join("\n");
}

export function isUntouched(db: Db): boolean {
  const folders = db.folders.filter((folder) => !folder.isDeleted);
  return (
    db.items.length === 0 &&
    db.tags.length === 0 &&
    db.people.length === 0 &&
    db.rules.length === 0 &&
    db.shoppingTemplates.length === 0 &&
    db.savedViews.length === 0 &&
    db.itemLinks.length === 0 &&
    db.dependencies.length === 0 &&
    db.itemTags.length === 0 &&
    folders.length <= 1 &&
    folders.every((folder) => folder.system === "inbox")
  );
}

export function mergeMissing(base: Db, local: Db): Db {
  const merged = structuredClone(base);
  const present = new Set(rowsFromDb(base).map((row) => `${row.kind}:${row.appId}`));
  for (const [kind, key] of collections) {
    for (const entity of local[key]) {
      if (present.has(`${kind}:${entity.id}`)) continue;
      (merged[key] as unknown[]).push(structuredClone(entity));
    }
  }
  return merged;
}
