import { describe, expect, it } from "vitest";
import { freshDb } from "../domain/reduce.ts";
import { dbFromRows, fingerprint, isUntouched, rowsFromDb } from "./syncMap.ts";

function ctx() {
  let n = 0;
  return {
    now: "2026-10-18T08:00:00.000Z",
    today: "2026-10-18",
    id: () => `id${n++}`,
  };
}

describe("synchronizace", () => {
  it("čerstvou databázi nepovažuje za data k odeslání", () => {
    expect(isUntouched(freshDb(ctx()))).toBe(true);
  });

  it("řádek se složí zpátky do stejných dat", () => {
    const db = freshDb(ctx());
    db.items.push({
      ...db.statuses[0]!,
      id: "task1",
      folderId: db.folders[0]!.id,
      type: "task",
      title: "Brát lék",
      body: null,
      statusId: db.statuses[0]!.id,
      priority: null,
      assigneeId: null,
      dueAt: "2026-10-17",
      dueHasTime: false,
      plannedFor: "2026-10-17",
      planUntil: null,
      store: null,
      quantity: null,
      unit: null,
      spec: null,
      templateId: null,
      parentItemId: null,
      seriesId: null,
      recurrenceFreq: null,
      recurrenceInterval: null,
      recurrenceWeekdays: null,
      recurrenceUntil: null,
      pristine: false,
      sortOrder: "a0",
      pinX: null,
      pinY: null,
      pinZ: null,
      pinW: null,
      pinH: null,
      isPinned: false,
      isArchived: false,
    });
    const back = dbFromRows(rowsFromDb(db));
    expect(back && fingerprint(back)).toBe(fingerprint(db));
  });
});
