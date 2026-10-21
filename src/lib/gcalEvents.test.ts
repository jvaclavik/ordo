import { describe, expect, it } from "vitest";
import {
  calendarFromApi,
  eventCount,
  eventFromApi,
  eventsOnDay,
  eventTimeLabel,
  monthWindow,
  type ApiEvent,
  type CalEvent,
} from "./gcalEvents.ts";

const calendar = { id: "me@example.com", color: "#039be5" };

function at(day: string, time: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, hours, minutes).toISOString();
}

function timed(id: string, from: [string, string], to: [string, string], extra: ApiEvent = {}) {
  return eventFromApi(
    {
      id,
      summary: id,
      start: { dateTime: at(...from) },
      end: { dateTime: at(...to) },
      ...extra,
    },
    calendar
  ) as CalEvent;
}

describe("Google events on Ordo days", () => {
  it("reads a timed meeting in the device's local time", () => {
    const event = timed("Standup", ["2026-10-21", "09:30"], ["2026-10-21", "09:45"]);
    expect(event).toMatchObject({
      id: "me@example.com|Standup",
      allDay: false,
      startDay: "2026-10-21",
      lastDay: "2026-10-21",
      startTime: "09:30",
      endTime: "09:45",
      color: "#039be5",
    });
    expect(eventTimeLabel(event, "2026-10-21")).toBe("09:30–09:45");
  });

  it("treats Google's exclusive all-day end date as the day before", () => {
    const trip = eventFromApi(
      { id: "trip", summary: "Praha", start: { date: "2026-10-23" }, end: { date: "2026-10-26" } },
      calendar
    ) as CalEvent;
    expect(trip.startDay).toBe("2026-10-23");
    expect(trip.lastDay).toBe("2026-10-25");
    expect(eventsOnDay([trip], "2026-10-25")).toHaveLength(1);
    expect(eventsOnDay([trip], "2026-10-26")).toHaveLength(0);
    expect(eventTimeLabel(trip, "2026-10-24")).toBeNull();
  });

  it("does not spill an event that ends at midnight into the next day", () => {
    const party = timed("Party", ["2026-10-24", "20:00"], ["2026-10-25", "00:00"]);
    expect(party.lastDay).toBe("2026-10-24");
    expect(eventsOnDay([party], "2026-10-25")).toHaveLength(0);
  });

  it("labels each day of a timed event that spans several days", () => {
    const conference = timed("Konference", ["2026-10-20", "18:00"], ["2026-10-22", "12:00"]);
    expect(eventTimeLabel(conference, "2026-10-20")).toBe("od 18:00");
    expect(eventTimeLabel(conference, "2026-10-21")).toBeNull();
    expect(eventTimeLabel(conference, "2026-10-22")).toBe("do 12:00");
    const weekend = timed("Chata", ["2026-10-23", "17:00"], ["2026-10-26", "00:00"]);
    expect(weekend.lastDay).toBe("2026-10-25");
    expect(eventTimeLabel(weekend, "2026-10-25")).toBeNull();
  });

  it("skips cancelled, declined and working-location entries", () => {
    const base = {
      start: { dateTime: at("2026-10-21", "10:00") },
      end: { dateTime: at("2026-10-21", "11:00") },
    };
    expect(eventFromApi({ id: "a", status: "cancelled", ...base }, calendar)).toBeNull();
    expect(
      eventFromApi(
        { id: "b", attendees: [{ self: true, responseStatus: "declined" }], ...base },
        calendar
      )
    ).toBeNull();
    expect(eventFromApi({ id: "c", eventType: "workingLocation", ...base }, calendar)).toBeNull();
    expect(eventFromApi({ id: "d", ...base }, calendar)?.title).toBe("(bez názvu)");
  });

  it("prefers the event's own color over the calendar color", () => {
    const event = timed("Lékař", ["2026-10-21", "08:00"], ["2026-10-21", "08:30"], {
      colorId: "11",
    });
    expect(event.color).toBe("#d50000");
  });

  it("orders a day as all-day first, then by start time", () => {
    const late = timed("Večeře", ["2026-10-21", "19:00"], ["2026-10-21", "21:00"]);
    const early = timed("Běh", ["2026-10-21", "07:00"], ["2026-10-21", "08:00"]);
    const holiday = eventFromApi(
      { id: "svátek", summary: "Svátek", start: { date: "2026-10-21" }, end: { date: "2026-10-22" } },
      calendar
    ) as CalEvent;
    expect(eventsOnDay([late, early, holiday], "2026-10-21").map((event) => event.title)).toEqual([
      "Svátek",
      "Běh",
      "Večeře",
    ]);
  });

  it("asks Google for exactly one local month", () => {
    const window = monthWindow("2026-12");
    expect(new Date(window.timeMin).getMonth()).toBe(11);
    expect(new Date(window.timeMin).getDate()).toBe(1);
    expect(new Date(window.timeMax).getFullYear()).toBe(2027);
    expect(new Date(window.timeMax).getMonth()).toBe(0);
  });

  it("keeps the calendar name the user gave it and hides removed calendars", () => {
    expect(
      calendarFromApi({ id: "x", summary: "Rodina", summaryOverride: "Doma", selected: false })
    ).toEqual({ id: "x", name: "Doma", color: null, primary: false, selected: false, managed: false });
    expect(calendarFromApi({ id: "o", summary: "Ordo", description: "Úkoly (ordo-sync)" })?.managed).toBe(true);
    expect(calendarFromApi({ id: "y", deleted: true })).toBeNull();
  });

  it("counts events in Czech", () => {
    expect(eventCount(1)).toBe("1 událost");
    expect(eventCount(3)).toBe("3 události");
    expect(eventCount(5)).toBe("5 událostí");
  });
});
