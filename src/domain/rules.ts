import { alive, byId } from "./db.ts";
import { fold } from "./text.ts";
import type { Db, Item, Rule } from "./types.ts";

export function orderedRules(db: Db): Rule[] {
  return alive(db.rules).sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
}

export function matchingRule(db: Db, item: Pick<Item, "title" | "body">, tagIds: string[]): Rule | null {
  const haystack = fold(`${item.title}\n${item.body ?? ""}`);
  for (const rule of orderedRules(db)) {
    if (!rule.enabled) continue;
    if (!rule.matchText && !rule.matchTagId) continue;
    if (rule.matchText && !haystack.includes(fold(rule.matchText))) continue;
    if (rule.matchTagId && !tagIds.includes(rule.matchTagId)) continue;
    if (!byId(db.folders, rule.actionFolderId) || byId(db.folders, rule.actionFolderId)?.isDeleted) continue;
    return rule;
  }
  return null;
}
