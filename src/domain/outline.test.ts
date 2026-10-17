import { generateKeyBetween } from "fractional-indexing";
import { describe, expect, it } from "vitest";
import { indentOutline, nestOutline, outdentOutline, type OutlineNode } from "./outline.ts";

const k0 = generateKeyBetween(null, null);
const k1 = generateKeyBetween(k0, null);
const k2 = generateKeyBetween(k1, null);
const k3 = generateKeyBetween(k2, null);

function node(
  id: string,
  sortOrder: string,
  parentItemId: string | null = null,
): OutlineNode {
  return { id, sortOrder, parentItemId, folderId: "home" };
}

function ids(items: OutlineNode[]) {
  return nestOutline(items).map((row) => `${row.item.id}:${row.depth}`);
}

describe("odsazení úkolů", () => {
  const flat = [node("a", k0), node("b", k1), node("c", k2)];

  it("drží kořeny v daném pořadí a děti pod rodičem", () => {
    const items = [
      node("a", k0),
      node("c", k2),
      node("b", k1, "a"),
      node("b1", k0, "b"),
    ];
    expect(ids(items)).toEqual(["a:0", "b:1", "b1:2", "c:0"]);
  });

  it("tab posune úkol pod předchozího sourozence", () => {
    const [patch] = indentOutline(flat, flat, "b");
    expect(patch).toMatchObject({ id: "b", parentItemId: "a" });
    const next = flat.map((item) => (item.id === "b" ? { ...item, ...patch! } : item));
    expect(ids(next)).toEqual(["a:0", "b:1", "c:0"]);
  });

  it("tab na prvním úkolu nic nemění", () => {
    expect(indentOutline(flat, flat, "a")).toEqual([]);
  });

  it("tab vloží úkol za existující děti", () => {
    const items = [node("a", k0), node("a1", k0, "a"), node("b", k1)];
    const [patch] = indentOutline(items, items, "b");
    expect(patch?.parentItemId).toBe("a");
    expect(patch && patch.sortOrder > k0).toBe(true);
    const next = items.map((item) => (item.id === "b" ? { ...item, ...patch! } : item));
    expect(ids(next)).toEqual(["a:0", "a1:1", "b:1"]);
  });

  it("shift tab vytáhne úkol a následující sourozence vezme s sebou", () => {
    const items = [
      node("a", k0),
      node("b", k1, "a"),
      node("b1", k0, "b"),
      node("c", k2, "a"),
      node("c1", k0, "c"),
      node("d", k3),
    ];
    const patches = outdentOutline(items, items, "b");
    const next = items.map((item) => {
      const patch = patches.find((entry) => entry.id === item.id);
      return patch ? { ...item, ...patch } : item;
    });
    expect(patches.find((entry) => entry.id === "b")?.parentItemId).toBe(null);
    expect(patches.find((entry) => entry.id === "c")?.parentItemId).toBe("b");
    expect(ids(next)).toEqual(["a:0", "b:0", "b1:1", "c:1", "c1:2", "d:0"]);
  });

  it("shift tab na kořeni nic nemění", () => {
    expect(outdentOutline(flat, flat, "a")).toEqual([]);
  });
});
