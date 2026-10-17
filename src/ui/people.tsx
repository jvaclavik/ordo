import { useDroppable } from "@dnd-kit/core";
import { nanoid } from "nanoid";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { dispatch, useSnap } from "../data/store.tsx";
import { alive, statusMeaning } from "../domain/db.ts";
import { meaningLabel } from "../domain/labels.ts";
import { personItems } from "../domain/select.ts";
import type { StatusMeaning } from "../domain/types.ts";
import { ItemList } from "./tasks.tsx";
import { Button, control, cx, Field, hoverRow, OpenMark } from "./ui.tsx";

const MEANINGS: StatusMeaning[] = ["todo", "doing", "done"];

export function PeoplePage() {
  const { db } = useSnap();
  const [name, setName] = useState("");
  const people = alive(db.people);
  return (
    <div>
      <h1 className="font-display text-3xl">Lidé</h1>
      <p className="mb-4 text-muted">
        Zatím jde o štítky. Sdílení přijde později.
      </p>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          dispatch({
            type: "createPerson",
            id: nanoid(10),
            name: name.trim(),
            color: null,
            emoji: null,
          });
          setName("");
        }}
      >
        <Field label="Jméno">
          <input
            className={control}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button tone="solid" className="self-end" type="submit">
          Přidat
        </Button>
      </form>
      <div className="grid gap-2">
        {people.map((person) => (
          <PersonLink
            key={person.id}
            id={person.id}
            name={person.name}
            count={
              personItems(db, person.id).filter(
                (item) => statusMeaning(db, item.statusId) !== "done"
              ).length
            }
          />
        ))}
      </div>
    </div>
  );
}

function PersonLink({
  id,
  name,
  count,
}: {
  id: string;
  name: string;
  count: number;
}) {
  const drop = useDroppable({
    id: `person:${id}`,
    data: { kind: "person", personId: id },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={cx("rounded-2xl", drop.isOver && "bg-accent-soft")}
    >
      <Link
        href={`/people/${id}`}
        className={cx(
          "flex items-center justify-between gap-3 bg-raised px-4 py-3",
          hoverRow
        )}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="rounded-sm bg-black/5 px-1.5 py-0.5 text-xs text-muted dark:bg-white/10">
          {count}
        </span>
        <OpenMark />
      </Link>
    </div>
  );
}

export function PersonPage({ personId }: { personId: string }) {
  const { db } = useSnap();
  const [, setLocation] = useLocation();
  const person = alive(db.people).find((entry) => entry.id === personId);
  if (!person) return <p>Člověk tu není.</p>;
  const items = personItems(db, person.id);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl">{person.name}</h1>
        <Button
          tone="danger"
          onClick={() => {
            dispatch({ type: "deletePerson", id: person.id });
            setLocation("/people");
          }}
        >
          Smazat
        </Button>
      </div>
      <div className="board-row">
        {(items.some((item) => statusMeaning(db, item.statusId) === "none")
          ? [...MEANINGS, "none" as const]
          : MEANINGS
        ).map((meaning) => {
          const column = items.filter(
            (item) => statusMeaning(db, item.statusId) === meaning
          );
          return (
            <MeaningColumn key={meaning} meaning={meaning} items={column} />
          );
        })}
      </div>
    </div>
  );
}

function MeaningColumn({
  meaning,
  items,
}: {
  meaning: StatusMeaning;
  items: Parameters<typeof ItemList>[0]["items"];
}) {
  const drop = useDroppable({
    id: `meaning:${meaning}`,
    data: { kind: "meaning", meaning },
  });
  return (
    <section
      ref={drop.setNodeRef}
      className={cx(
        "board-col rounded-lg border border-line bg-panel p-3",
        drop.isOver && "bg-accent-soft"
      )}
      data-meaning={meaning}
    >
      <h2 className="px-2 py-1 text-sm">{meaningLabel(meaning)}</h2>
      <ItemList items={items} showFolder />
    </section>
  );
}
