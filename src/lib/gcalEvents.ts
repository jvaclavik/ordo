import { addDays, dateKey } from "../domain/dates.ts";

export type ApiEventTime = { date?: string; dateTime?: string };

export type ApiEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  eventType?: string;
  transparency?: string;
  start?: ApiEventTime;
  end?: ApiEventTime;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

export type ApiCalendar = {
  id?: string;
  summary?: string;
  description?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
};

export type GcalCalendar = {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  selected: boolean;
  managed: boolean;
};

// The calendar Ordo writes its tasks into carries this mark in its description.
export const MANAGED_MARK = "ordo-sync";

export type CalEvent = {
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  link: string | null;
  color: string | null;
  allDay: boolean;
  startDay: string;
  lastDay: string;
  startTime: string | null;
  endTime: string | null;
};

// Google's current event palette. The API's /colors endpoint still serves the
// older pastel set, which no longer matches what the Google Calendar UI shows.
const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

type Edge = { day: string; time: string | null };

function edge(time: ApiEventTime | undefined): Edge | null {
  if (time?.date) return { day: time.date.slice(0, 10), time: null };
  if (!time?.dateTime) return null;
  const at = new Date(time.dateTime);
  if (Number.isNaN(at.getTime())) return null;
  return { day: dateKey(at), time: clock(at) };
}

export function calendarFromApi(raw: ApiCalendar): GcalCalendar | null {
  if (!raw.id || raw.deleted || raw.hidden) return null;
  return {
    id: raw.id,
    name: raw.summaryOverride?.trim() || raw.summary?.trim() || raw.id,
    color: raw.backgroundColor ?? null,
    primary: raw.primary === true,
    selected: raw.selected !== false,
    managed: raw.description?.includes(MANAGED_MARK) === true,
  };
}

export function eventFromApi(
  raw: ApiEvent,
  calendar: Pick<GcalCalendar, "id" | "color">
): CalEvent | null {
  if (!raw.id || raw.status === "cancelled") return null;
  if (raw.eventType === "workingLocation") return null;
  if (raw.attendees?.some((guest) => guest.self && guest.responseStatus === "declined"))
    return null;
  const start = edge(raw.start);
  if (!start) return null;
  const end = edge(raw.end);
  const base = {
    id: `${calendar.id}|${raw.id}`,
    calendarId: calendar.id,
    title: raw.summary?.trim() || "(bez názvu)",
    location: raw.location?.trim() || null,
    link: raw.htmlLink ?? null,
    color: (raw.colorId && EVENT_COLORS[raw.colorId]) || calendar.color,
  };
  if (start.time === null) {
    const endDay = end && end.time === null ? addDays(end.day, -1) : start.day;
    return {
      ...base,
      allDay: true,
      startDay: start.day,
      lastDay: endDay > start.day ? endDay : start.day,
      startTime: null,
      endTime: null,
    };
  }
  let lastDay = end?.day ?? start.day;
  if (end && end.time === "00:00" && end.day > start.day)
    lastDay = addDays(end.day, -1);
  if (lastDay < start.day) lastDay = start.day;
  return {
    ...base,
    allDay: false,
    startDay: start.day,
    lastDay,
    startTime: start.time,
    endTime: end?.time ?? null,
  };
}

export function monthWindow(month: string): { timeMin: string; timeMax: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return {
    timeMin: new Date(year, index, 1).toISOString(),
    timeMax: new Date(year, index + 1, 1).toISOString(),
  };
}

function coversWholeDay(event: CalEvent, day: string): boolean {
  if (event.allDay) return true;
  if (day <= event.startDay) return false;
  if (day < event.lastDay) return true;
  return day === event.lastDay && event.endTime === "00:00";
}

// What the time column says for an event on one particular day.
export function eventTimeLabel(event: CalEvent, day: string): string | null {
  if (coversWholeDay(event, day)) return null;
  const single = event.startDay === event.lastDay;
  if (single) {
    if (!event.endTime || event.endTime === event.startTime) return event.startTime;
    return `${event.startTime}–${event.endTime}`;
  }
  if (day === event.startDay) return `od ${event.startTime}`;
  return event.endTime ? `do ${event.endTime}` : null;
}

function startsOn(event: CalEvent, day: string): string {
  if (coversWholeDay(event, day)) return "";
  if (day === event.startDay) return event.startTime ?? "";
  return "00:00";
}

export function eventsOnDay(events: CalEvent[], day: string): CalEvent[] {
  return events
    .filter((event) => event.startDay <= day && day <= event.lastDay)
    .sort((left, right) => {
      const leftAt = startsOn(left, day);
      const rightAt = startsOn(right, day);
      if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
      return left.title.localeCompare(right.title, "cs");
    });
}

export function eventCount(count: number): string {
  if (count === 1) return "1 událost";
  if (count >= 2 && count <= 4) return `${count} události`;
  return `${count} událostí`;
}
