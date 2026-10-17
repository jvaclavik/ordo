export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayKey(now = new Date()): string {
  return dateKey(now);
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.slice(0, 10).split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function addMonths(key: string, months: number): string {
  const date = parseDateKey(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return dateKey(date);
}

export function isoWeekday(key: string): number {
  const day = parseDateKey(key).getDay();
  return day === 0 ? 7 : day;
}

export function formatDay(key: string, today: string): string {
  if (key === today) return "dnes";
  if (key === addDays(today, 1)) return "zítra";
  if (key === addDays(today, 2)) return "pozítří";
  if (key === addDays(today, -1)) return "včera";
  if (key === addDays(today, -2)) return "předevčírem";
  const date = parseDateKey(key);
  const sameYear = date.getFullYear() === parseDateKey(today).getFullYear();
  return date.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function dueDateKey(dueAt: string | null): string | null {
  if (!dueAt) return null;
  return dueAt.slice(0, 10);
}

export function dueTime(dueAt: string | null, dueHasTime: boolean): string | null {
  if (!dueAt || !dueHasTime || dueAt.length < 16) return null;
  return dueAt.slice(11, 16);
}

export function combineDue(day: string | null, time: string | null): { dueAt: string | null; dueHasTime: boolean } {
  if (!day) return { dueAt: null, dueHasTime: false };
  if (!time) return { dueAt: day, dueHasTime: false };
  return { dueAt: `${day}T${time}`, dueHasTime: true };
}

export type DueChoice = {
  id: string;
  label: string;
  day: string;
  time: string | null;
};

export function dueChoices(today: string, now = new Date()): DueChoice[] {
  const choices: DueChoice[] = [
    { id: "today", label: "dnes", day: today, time: null },
  ];
  const later = laterToday(today, now);
  if (later) choices.push({ id: "later", label: "později dnes", day: today, time: later });
  choices.push(
    { id: "tomorrow", label: "zítra", day: addDays(today, 1), time: null },
    { id: "overmorrow", label: "pozítří", day: addDays(today, 2), time: null },
    weekendChoice(today),
    {
      id: "next-week",
      label: "příští týden",
      day: addDays(addDays(today, 1 - isoWeekday(today)), 7),
      time: null,
    }
  );
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${choice.day}T${choice.time ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function laterToday(today: string, now: Date): string | null {
  if (dateKey(now) !== today) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 16 * 60) return "18:00";
  const hour = Math.ceil((minutes + 180) / 60);
  if (hour >= 24) return null;
  return `${String(hour).padStart(2, "0")}:00`;
}

function weekendChoice(today: string): DueChoice {
  const weekday = isoWeekday(today);
  const thisSaturday = addDays(today, (6 - weekday + 7) % 7);
  if (weekday < 5) {
    return { id: "weekend", label: "o víkendu", day: thisSaturday, time: null };
  }
  const nextSaturday = weekday === 6 ? addDays(today, 7) : addDays(thisSaturday, 7);
  return { id: "weekend", label: "příští víkend", day: nextSaturday, time: null };
}

const WEEKDAYS: Record<string, number> = {
  pondeli: 1,
  po: 1,
  utery: 2,
  ut: 2,
  streda: 3,
  st: 3,
  ctvrtek: 4,
  ct: 4,
  patek: 5,
  pa: 5,
  sobota: 6,
  so: 6,
  nedele: 7,
  ne: 7,
};

export function nextWeekday(today: string, weekday: number): string {
  const current = isoWeekday(today);
  const delta = (weekday - current + 7) % 7;
  return addDays(today, delta);
}

export function resolveMonthDay(today: string, day: number, month: number, year?: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const resolvedYear = year ?? Number(today.slice(0, 4));
  const candidate = clampDay(resolvedYear, month, day);
  if (year !== undefined) return candidate;
  return candidate < today ? clampDay(resolvedYear + 1, month, day) : candidate;
}

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  return dateKey(new Date(year, month - 1, Math.min(day, last)));
}

export function weekdayFromName(name: string): number | null {
  return WEEKDAYS[name] ?? null;
}
