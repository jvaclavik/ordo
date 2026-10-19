import { addDays, addMonths, isoWeekday } from "./dates.ts";
import type { Item, RecurrenceFreq } from "./types.ts";

export type Recurrence = {
  freq: RecurrenceFreq;
  interval: number;
  weekdays: number[];
  until: string | null;
};

export function weekdaysFrom(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number(part))
    .filter((day) => day >= 1 && day <= 7);
}

export function weekdaysTo(days: number[]): string | null {
  const unique = [...new Set(days.filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b);
  return unique.length > 0 ? unique.join(",") : null;
}

export function recurrenceOf(item: Item): Recurrence | null {
  if (!item.recurrenceFreq) return null;
  return {
    freq: item.recurrenceFreq,
    interval: Math.max(1, item.recurrenceInterval ?? 1),
    weekdays: weekdaysFrom(item.recurrenceWeekdays),
    until: item.recurrenceUntil,
  };
}

export function nextOccurrence(fromDay: string, rule: Recurrence): string | null {
  const interval = Math.max(1, rule.interval);
  let next: string;
  if (rule.freq === "monthly") {
    next = addMonths(fromDay, interval);
  } else if (rule.freq === "yearly") {
    next = addMonths(fromDay, interval * 12);
  } else if (rule.freq === "weekly") {
    const days = rule.weekdays.length > 0 ? rule.weekdays : [isoWeekday(fromDay)];
    if (interval === 1) {
      next = scanWeekdays(fromDay, days, 1) ?? addDays(fromDay, 7);
    } else {
      const base = addDays(fromDay, 7 * interval);
      next = scanWeekdays(addDays(base, -1), days, 1) ?? base;
    }
  } else {
    next = addDays(fromDay, interval);
  }
  if (rule.until && next > rule.until) return null;
  return next;
}

function scanWeekdays(fromDay: string, days: number[], startOffset: number): string | null {
  for (let offset = startOffset; offset <= 7; offset += 1) {
    const candidate = addDays(fromDay, offset);
    if (days.includes(isoWeekday(candidate))) return candidate;
  }
  return null;
}

export type RepeatPreset = "never" | "daily" | "weekly" | "monthly" | "yearly" | "custom";

export function recurrencePreset(rule: Recurrence | null, anchorDay: string): RepeatPreset {
  if (!rule) return "never";
  if (rule.until || rule.interval !== 1 || rule.freq === "interval") return "custom";
  if (rule.freq === "daily" || rule.freq === "monthly" || rule.freq === "yearly") return rule.freq;
  if (rule.weekdays.length === 0) return "weekly";
  if (rule.weekdays.length === 1 && rule.weekdays[0] === isoWeekday(anchorDay)) return "weekly";
  return "custom";
}

const WEEKDAY_SHORT = ["", "po", "út", "st", "čt", "pá", "so", "ne"];

export function recurrenceLabel(item: Item): string | null {
  const rule = recurrenceOf(item);
  if (!rule) return null;
  if (rule.freq === "daily" || rule.freq === "interval") {
    return rule.interval === 1 ? "každý den" : `každých ${rule.interval} dní`;
  }
  if (rule.freq === "monthly") {
    return rule.interval === 1 ? "každý měsíc" : `každých ${rule.interval} měsíců`;
  }
  if (rule.freq === "yearly") {
    return rule.interval === 1 ? "každý rok" : `každých ${rule.interval} let`;
  }
  const days = rule.weekdays.map((day) => WEEKDAY_SHORT[day] ?? "").filter(Boolean);
  const dayLabel = days.length > 0 ? ` ${days.join(" ")}` : "";
  return rule.interval === 1 ? `každý týden${dayLabel}` : `každé ${rule.interval} týdny${dayLabel}`;
}
