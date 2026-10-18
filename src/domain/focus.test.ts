import { describe, expect, it } from "vitest";
import { newItem } from "./factory.ts";
import { freshDb, reduce } from "./reduce.ts";
import { focusSections } from "./select.ts";
import type { Ctx, Db, Priority } from "./types.ts";

const today = "2026-10-16";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-16T08:00:00.000Z",
    today,
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

function add(
  db: Db,
  base: Ctx,
  id: string,
  title: string,
  extra: { dueAt?: string; plannedFor?: string; priority?: Priority | null } = {},
) {
  const inbox = db.folders[0]!.id;
  return reduce(
    db,
    {
      type: "createItem",
      item: newItem({
        id,
        folderId: inbox,
        title,
        applyRules: false,
        dueAt: extra.dueAt ?? null,
        plannedFor: extra.plannedFor ?? null,
        priority: extra.priority ?? null,
      }),
    },
    base,
  );
}

function ids(db: Db, section: string) {
  return focusSections(db, today).find((row) => row.id === section)?.items.map((item) => item.id) ?? [];
}

describe("přehled dne", () => {
  it("rozdělí úkoly a každý ukáže jen jednou", () => {
    const base = ctx();
    let db = freshDb(base);
    db = add(db, base, "late", "Po termínu", { dueAt: "2026-10-14" });
    db = add(db, base, "now", "Dnes termín", { dueAt: today });
    db = add(db, base, "plan", "Dnes plán", { plannedFor: today, dueAt: "2026-10-20" });
    db = add(db, base, "week", "Do týdne", { dueAt: "2026-10-20" });
    db = add(db, base, "later", "Později plán", { plannedFor: "2026-10-19" });
    db = add(db, base, "hot", "Urgentní", { priority: "urgent" });
    db = add(db, base, "high", "Vysoká s termínem", { priority: "high", dueAt: "2026-10-18" });
    db = add(db, base, "free", "Volný");
    db = add(db, base, "wait", "Čeká");
    db = add(db, base, "block", "Blokuje");
    db = reduce(db, { type: "addDependency", id: "dep", itemId: "wait", dependsOnId: "block" }, base);

    expect(ids(db, "overdue")).toEqual(["late"]);
    expect(ids(db, "today")).toEqual(["now", "plan"]);
    expect(ids(db, "soon")).toEqual(["high", "later", "week"]);
    expect(ids(db, "priority")).toEqual(["hot"]);
    expect(ids(db, "ready")).toEqual(["free", "block"]);
    expect(ids(db, "ready")).not.toContain("wait");
  });
});
