import { dueDateKey, dueTime, parseDateKey } from "../domain/dates.ts";
import type { Item } from "../domain/types.ts";

function stamp(day: string): string {
  return day.replaceAll("-", "");
}

function escapeText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

export function itemToIcs(item: Item): string | null {
  const due = dueDateKey(item.dueAt);
  const day = due ?? item.plannedFor;
  if (!day) return null;
  const time = dueTime(item.dueAt, item.dueHasTime);
  const spanEnd =
    !time && !due && item.planUntil && item.planUntil > day ? item.planUntil : day;
  const start = time ? `${stamp(day)}T${time.replace(":", "")}00` : stamp(day);
  const endDay = time ? start : stamp(nextDay(spanEnd));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ukoly//CS",
    "BEGIN:VEVENT",
    `UID:${item.id}@ukoly`,
    `SUMMARY:${escapeText(item.title)}`,
    item.body ? `DESCRIPTION:${escapeText(item.body)}` : "",
    time ? `DTSTART:${start}` : `DTSTART;VALUE=DATE:${start}`,
    time ? `DTEND:${endOfHour(start)}` : `DTEND;VALUE=DATE:${endDay}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function nextDay(day: string): string {
  const date = parseDateKey(day);
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const value = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${value}`;
}

function endOfHour(start: string): string {
  const hour = Number(start.slice(9, 11));
  const next = String((hour + 1) % 24).padStart(2, "0");
  return `${start.slice(0, 9)}${next}${start.slice(11)}`;
}

export function googleCalendarUrl(item: Item): string | null {
  const due = dueDateKey(item.dueAt);
  const day = due ?? item.plannedFor;
  if (!day) return null;
  const time = dueTime(item.dueAt, item.dueHasTime);
  const spanEnd =
    !time && !due && item.planUntil && item.planUntil > day ? item.planUntil : day;
  const start = time ? `${stamp(day)}T${time.replace(":", "")}00` : stamp(day);
  const end = time ? endOfHour(start) : nextDay(spanEnd);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: `${start}/${end}`,
    details: item.body ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcs(item: Item) {
  const contents = itemToIcs(item);
  if (!contents) return;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.title.slice(0, 40) || "ukol"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
