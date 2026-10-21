import { describe, expect, it } from "vitest";
import { byId } from "./db.ts";
import {
  findMoney,
  findSpokenPeople,
  findSpots,
  findSymbol,
} from "./dictate.ts";
import { opsFromQuickAdd, parseQuickAdd } from "./quickAdd.ts";
import { freshDb, reduce } from "./reduce.ts";
import type { Ctx } from "./types.ts";

function ctx(): Ctx {
  let count = 0;
  return {
    now: "2026-10-16T08:00:00.000Z",
    today: "2026-10-16",
    id: () => {
      count += 1;
      return `n${count}`;
    },
  };
}

const today = "2026-10-16";

describe("diktát", () => {
  it("pozná cestu, člověka, částku, symbol a místnost", () => {
    const db = freshDb(ctx());
    const line =
      "jet z Prahy do Brna s Honzou zaplatit 1 200,50 Kč VS 1234567890 kancelář 4.12 3. patro zvonek Novák";
    const parsed = parseQuickAdd(line, db, today);
    expect(parsed.title).toBe(line);
    expect(parsed.origin).toBe("Prahy");
    expect(parsed.place).toBe("Brna");
    expect(parsed.personNames).toEqual(["Honzou"]);
    expect(parsed.amount).toBe("1 200,50 Kč");
    expect(parsed.variableSymbol).toBe("1234567890");
    expect(parsed.spot).toBe("Kancelář 4.12, 3. patro, Zvonek Novák");
    expect(findSpots("kanceláři 4.12")[0]?.label).toBe("Kancelář 4.12");
    expect(findMoney("350,-")?.label).toBe("350 Kč");
    expect(findMoney("12 eur")?.label).toBe("12 €");
    expect(findSymbol("variabilní symbol 42")?.symbol).toBe("42");
    expect(findSpokenPeople("koupit mléko s sebou")).toEqual([]);
  });

  it("založí kontakt z jedné věty a zná už uloženého člověka", () => {
    const base = ctx();
    let db = freshDb(base);
    db = reduce(
      db,
      {
        type: "createPerson",
        id: "honza",
        name: "Honza",
        color: null,
        emoji: null,
      },
      base
    );
    const known = parseQuickAdd("schůzka s honzou", db, today);
    expect(known.personNames).toEqual(["Honza"]);
    expect(known.title).toBe("schůzka s honzou");
    const fresh = freshDb(base);
    const inbox = fresh.folders[0]!;
    const parsed = parseQuickAdd(
      "kontakt jana nováková 777 123 456 adresa Hlavní 5, Dobříš",
      fresh,
      today
    );
    expect(parsed.personNames).toEqual(["Jana Nováková"]);
    expect(
      parseQuickAdd("napiš jan@firma.cz", fresh, today).personNames
    ).toEqual([]);
    expect(parsed.place).toBe("Hlavní 5, Dobříš");
    expect(parsed.title).toContain("jana nováková");
    const saved = opsFromQuickAdd(fresh, parsed, {
      folderId: inbox.id,
      statusId: null,
      dateRole: "due",
      applyRules: false,
      itemId: "kontakt",
      ids: base.id,
    }).reduce((state, op) => reduce(state, op, base), fresh);
    expect(byId(saved.items, "kontakt")?.place).toBe("Hlavní 5, Dobříš");
    expect(byId(saved.items, "kontakt")?.assigneeId).toBeTruthy();
    expect(saved.people.map((person) => person.name)).toContain(
      "Jana Nováková"
    );
  });
});
