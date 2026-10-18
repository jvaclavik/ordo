import { useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import {
  addMonths,
  dueDateKey,
  formatDay,
  isoWeekday,
  parseDateKey,
  todayKey,
} from "../domain/dates.ts";
import { planOnDay } from "../domain/horizon.ts";
import type { Item } from "../domain/types.ts";
import { useUi } from "./state.tsx";
import { clickItem, itemMarked } from "./tasks.tsx";
import { Button, cx, hoverRow, OpenMark, PriorityMark } from "./ui.tsx";

const HEADS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export function monthCells(month: string): Array<string | null> {
  const first = `${month}-01`;
  const pad = isoWeekday(first) - 1;
  const origin = parseDateKey(first);
  const count = new Date(
    origin.getFullYear(),
    origin.getMonth() + 1,
    0
  ).getDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= count; day += 1)
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  return cells;
}

export function itemsOnDay(items: Item[], day: string): Item[] {
  return items.filter(
    (item) =>
      dueDateKey(item.dueAt) === day ||
      planOnDay(item.plannedFor, item.planUntil, day)
  );
}

export function CalendarBoard({ items }: { items: Item[] }) {
  const today = todayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const cells = monthCells(month);
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("cs-CZ", {
    month: "long",
    year: "numeric",
  });
  const selected = itemsOnDay(items, picked);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}
        >
          Předchozí
        </Button>
        <h2 className="font-display text-2xl capitalize">{label}</h2>
        <Button
          onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}
        >
          Další
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {HEADS.map((head) => (
          <div key={head}>{head}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) =>
          day ? (
            <DayCell
              key={day}
              day={day}
              today={today}
              active={day === picked}
              count={itemsOnDay(items, day).length}
              onPick={() => setPicked(day)}
            />
          ) : (
            <div key={`empty-${index}`} />
          )
        )}
      </div>
      <section>
        <h3 className="mb-2 text-sm text-muted">{formatDay(picked, today)}</h3>
        <DayItems items={selected} />
      </section>
    </div>
  );
}

function DayCell({
  day,
  today,
  active,
  count,
  onPick,
}: {
  day: string;
  today: string;
  active: boolean;
  count: number;
  onPick: () => void;
}) {
  const drop = useDroppable({ id: `plan:${day}`, data: { kind: "plan", day } });
  return (
    <button
      ref={drop.setNodeRef}
      type="button"
      onClick={onPick}
      className={cx(
        "min-h-12 rounded-md border px-1 py-1 text-left text-sm",
        active
          ? "border-accent bg-accent-soft"
          : "border-transparent hover:bg-black/5 dark:hover:bg-white/10",
        drop.isOver && "border-accent bg-accent-soft",
        day === today && "font-medium"
      )}
    >
      <span>{Number(day.slice(-2))}</span>
      {count > 0 && (
        <span className="mt-1 block text-xs text-muted">{count}</span>
      )}
    </button>
  );
}

function DayItems({ items }: { items: Item[] }) {
  const ui = useUi();
  if (items.length === 0)
    return <p className="text-sm text-muted">Na tenhle den nic není.</p>;
  return (
    <div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-task-id={item.id}
          className={cx(
            "flex w-full items-center gap-2 px-2 py-1.5 text-left",
            hoverRow,
            itemMarked(ui.picked, ui.selectedId, item.id) &&
              "bg-accent/25"
          )}
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault();
          }}
          onClick={(event) => clickItem(ui, item.id, event)}
        >
          <PriorityMark priority={item.priority} />
          <span className="min-w-0 flex-1 truncate">
            {item.dueHasTime && item.dueAt
              ? `${item.dueAt.slice(11, 16)} `
              : ""}
            {item.title}
          </span>
          <OpenMark />
        </button>
      ))}
    </div>
  );
}

export function PlanTargets() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <PlanChip id="plan:today" label="Sem přetáhni úkol na dnešek" />
      <PlanChip id="plan:tomorrow" label="Sem přetáhni úkol na zítřek" />
    </div>
  );
}

function PlanChip({ id, label }: { id: string; label: string }) {
  const drop = useDroppable({ id });
  return (
    <div
      ref={drop.setNodeRef}
      className={cx(
        "cursor-default rounded-md border border-dashed border-line px-3 py-3 text-sm text-muted",
        drop.isOver && "border-accent bg-accent-soft text-accent"
      )}
    >
      {label}
    </div>
  );
}
