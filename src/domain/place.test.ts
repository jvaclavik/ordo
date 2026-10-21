import { describe, expect, it } from "vitest";
import { byId } from "./db.ts";
import { findOrigin, findPlace, routeHref } from "./place.ts";
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

describe("destinace", () => {
  it("vezme místo za předložkou a nechá ho v názvu", () => {
    const hit = findPlace("jet na Dobříš");
    expect(hit).toEqual({ name: "Dobříš", start: 4, end: 13 });
    const db = freshDb(ctx());
    const parsed = parseQuickAdd("jet na dobříš zítra", db, today);
    expect(parsed.place).toBe("Dobříš");
    expect(parsed.title).toBe("jet na dobříš");
    expect(parsed.dueDay).toBe("2026-10-17");
    const inbox = db.folders[0]!;
    const saved = reduce(
      db,
      opsFromQuickAdd(db, parsed, {
        folderId: inbox.id,
        statusId: null,
        dateRole: "due",
        applyRules: false,
        itemId: "vylet",
        ids: () => "x",
      })[0]!,
      ctx()
    );
    expect(byId(saved.items, "vylet")?.place).toBe("Dobříš");
    expect(byId(saved.items, "vylet")?.title).toBe("jet na dobříš");
  });

  it("nechá poslední místo a zastaví se u člověka", () => {
    expect(findPlace("schůzka v Brně")?.name).toBe("Brně");
    expect(findPlace("z Prahy na Dobříš")?.name).toBe("Dobříš");
    expect(findPlace("jet na Dobříš s Honzou")).toEqual({
      name: "Dobříš",
      start: 4,
      end: 13,
    });
    expect(findPlace("jet na Český Krumlov")?.name).toBe("Český Krumlov");
    expect(findPlace("jet na Dobříš zavolej 777 123 456")?.name).toBe("Dobříš");
    expect(findPlace("jet na dobříš zavolej")?.name).toBe("Dobříš");
  });

  it("neplete si místo s termínem ani s nákupem", () => {
    expect(findPlace("koupit mléko")).toBeNull();
    expect(findPlace("úkol na pátek")).toBeNull();
    expect(findPlace("vysadit javor na jaře")).toBeNull();
    expect(findPlace("vypnout topení na víkend")).toBeNull();
    expect(findPlace("úkol na příští týden")).toBeNull();
    expect(findPlace("koupit mléko na snídani")).toBeNull();
    expect(findPlace("koupit beton do třech měsíců")).toBeNull();
    expect(findPlace("zavolat sklenářovi dneska ve 9:00")).toBeNull();
  });

  it("vezme adresu i s číslem a ulicí", () => {
    const line = "vyzvednout balík adresa Hlavní 12, Dobříš";
    const hit = findPlace(line);
    expect(hit?.name).toBe("Hlavní 12, Dobříš");
    expect(line.slice(hit?.start, hit?.end)).toBe("adresa Hlavní 12, Dobříš");
    expect(findPlace("na adrese Na Příkopech 12")?.name).toBe(
      "Na Příkopech 12"
    );
    expect(findPlace("jet na Hlavní 12")?.name).toBe("Hlavní 12");
    expect(findPlace("ulice: hlavní 12a dobříš")?.name).toBe(
      "Hlavní 12a Dobříš"
    );
    expect(findPlace("adresa")?.name).toBeUndefined();
    const db = freshDb(ctx());
    const parsed = parseQuickAdd(
      "vyzvednout balík adresa hlavní 12 zítra",
      db,
      today
    );
    expect(parsed.place).toBe("Hlavní 12");
    expect(parsed.title).toBe("vyzvednout balík adresa hlavní 12");
    expect(parsed.dueDay).toBe("2026-10-17");
  });

  it("vezme start i cíl a složí z nich trasu", () => {
    const line = "jet z Prahy do Brna";
    const destination = findPlace(line);
    const origin = findOrigin(line, destination);
    expect(destination?.name).toBe("Brna");
    expect(origin?.name).toBe("Prahy");
    expect(line.slice(origin?.start, origin?.end)).toBe("z Prahy");
    expect(line.slice(destination?.start, destination?.end)).toBe("do Brna");
    expect(routeHref("Brna", "Prahy")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Brna&origin=Prahy"
    );
    expect(routeHref("Brna")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Brna"
    );
  });
});
