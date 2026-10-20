import { addDays, isoWeekday } from "./dates.ts";
import { newItem } from "./factory.ts";
import type { Op } from "./op.ts";
import type { FolderPaint } from "./types.ts";

const doma = "demo-doma";
const prace = "demo-prace";
const cesty = "demo-cesty";
const recko = "demo-recko";
const napady = "demo-napady";

export function demoOps(today: string, inboxId: string): Op[] {
  const ops: Op[] = [];
  const folder = (
    id: string,
    name: string,
    icon: string,
    color: FolderPaint,
    todo: string,
    doing: string,
    done: string,
    parentId: string | null = null
  ) => {
    ops.push({
      type: "createFolder",
      id,
      parentId,
      name,
      icon,
      color,
      statusIds: { todo, doing, done },
    });
  };
  folder(
    doma,
    "Doma",
    "🏠",
    "c6",
    "demo-doma-todo",
    "demo-doma-doing",
    "demo-doma-done"
  );
  folder(
    prace,
    "Práce",
    "💻",
    "c4",
    "demo-prace-todo",
    "demo-prace-doing",
    "demo-prace-done"
  );
  folder(
    cesty,
    "Cesty",
    "✈️",
    "c11",
    "demo-cesty-todo",
    "demo-cesty-doing",
    "demo-cesty-done"
  );
  folder(
    recko,
    "Řecko",
    "🏝️",
    "c15",
    "demo-recko-todo",
    "demo-recko-doing",
    "demo-recko-done",
    cesty
  );
  folder(
    napady,
    "Nápady",
    "💡",
    "c3",
    "demo-napady-todo",
    "demo-napady-doing",
    "demo-napady-done"
  );
  ops.push({
    type: "updateFolder",
    id: doma,
    patch: { keywords: "odpad, mléko, pytle, nákup" },
  });
  ops.push({
    type: "updateFolder",
    id: prace,
    patch: { defaultView: "board" },
  });
  ops.push({
    type: "updateFolder",
    id: cesty,
    patch: { defaultView: "calendar", keywords: "pas, letenky" },
  });
  ops.push({
    type: "updateFolder",
    id: napady,
    patch: { defaultView: "notes" },
  });
  ops.push({
    type: "createPerson",
    id: "demo-jana",
    name: "Jana",
    color: "c5",
    emoji: null,
  });
  ops.push({
    type: "ensureTag",
    id: "demo-tag-domov",
    name: "domov",
    color: "c6",
  });
  ops.push({
    type: "ensureTag",
    id: "demo-tag-prace",
    name: "práce",
    color: "c4",
  });

  const add = (
    id: string,
    folderId: string,
    title: string,
    extra: Parameters<typeof newItem>[0] = { id, folderId, title }
  ) => {
    ops.push({
      type: "createItem",
      item: newItem({ applyRules: false, ...extra, id, folderId, title }),
    });
  };

  add("demo-odpad", doma, "Vynést tříděný odpad", {
    id: "demo-odpad",
    folderId: doma,
    title: "Vynést tříděný odpad",
    dueAt: `${today}T18:00`,
    dueHasTime: true,
    tagIds: ["demo-tag-domov"],
  });
  add("demo-mleko", doma, "Koupit mléko", {
    id: "demo-mleko",
    folderId: doma,
    title: "Koupit mléko",
    plannedFor: addDays(today, 1),
    priority: "low",
  });
  add("demo-elektrikar", doma, "Zavolat elektrikáři", {
    id: "demo-elektrikar",
    folderId: doma,
    title: "Zavolat elektrikáři",
    dueAt: addDays(today, -1),
    priority: "high",
    body: "Číslo je na lednici.",
  });
  add("demo-cislo", doma, "Najít číslo od elektrikáře", {
    id: "demo-cislo",
    folderId: doma,
    title: "Najít číslo od elektrikáře",
    parentItemId: "demo-elektrikar",
  });
  add("demo-pytle", inboxId, "Objednat pytle", {
    id: "demo-pytle",
    folderId: inboxId,
    title: "Objednat pytle",
  });
  add("demo-zapis", prace, "Týdenní zápis", {
    id: "demo-zapis",
    folderId: prace,
    title: "Týdenní zápis",
    statusId: "demo-prace-doing",
    assigneeId: "demo-jana",
    tagIds: ["demo-tag-prace"],
  });
  add("demo-podklady", prace, "Připravit podklady", {
    id: "demo-podklady",
    folderId: prace,
    title: "Připravit podklady",
    dueAt: addDays(today, 3),
    priority: "urgent",
  });
  add("demo-nabidka", prace, "Schválit nabídku", {
    id: "demo-nabidka",
    folderId: prace,
    title: "Schválit nabídku",
    plannedFor: addDays(today, 5),
  });
  add("demo-minule", prace, "Odeslat zápis z minula", {
    id: "demo-minule",
    folderId: prace,
    title: "Odeslat zápis z minula",
    statusId: "demo-prace-done",
  });
  add("demo-pas", cesty, "Obnovit pas", {
    id: "demo-pas",
    folderId: cesty,
    title: "Obnovit pas",
    dueAt: addDays(today, 21),
  });
  add("demo-letenky", recko, "Koupit letenky", {
    id: "demo-letenky",
    folderId: recko,
    title: "Koupit letenky",
    plannedFor: addDays(today, 10),
  });
  add("demo-ubytovani", recko, "Najít ubytování", {
    id: "demo-ubytovani",
    folderId: recko,
    title: "Najít ubytování",
    plannedFor: addDays(today, 12),
  });
  add("demo-napad", napady, "Nápad na víkend", {
    id: "demo-napad",
    folderId: napady,
    title: "Nápad na víkend",
    type: "note",
    body: "Vyrazit na hřebeny, dokud je světlo.\n\n- svačina\n- mapa",
  });
  ops.push({
    type: "setRecurrence",
    itemId: "demo-zapis",
    freq: "weekly",
    interval: 1,
    weekdays: String(isoWeekday(today)),
    until: null,
  });
  ops.push({
    type: "addDependency",
    id: "demo-dep",
    itemId: "demo-nabidka",
    dependsOnId: "demo-podklady",
  });
  ops.push({
    type: "createRule",
    id: "demo-rule",
    matchText: "pojišťovna",
    matchTagId: null,
    actionFolderId: doma,
    actionStatusId: null,
    actionTagId: null,
  });
  return ops;
}
