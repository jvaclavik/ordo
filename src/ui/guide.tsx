import {
  CalendarDays,
  Columns3,
  Folder,
  GripVertical,
  Keyboard,
  KeyRound,
  ListChecks,
  Mic,
  Search,
  Sparkles,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { dispatch } from "../data/store.tsx";
import { todayKey } from "../domain/dates.ts";
import { demoOps } from "../domain/demo.ts";

export function loadDemo(inboxId: string) {
  dispatch({ type: "batch", ops: demoOps(todayKey(), inboxId) });
}

const cards: {
  title: string;
  icon: LucideIcon;
  tint: string;
  text: string;
  extra?: ReactNode;
}[] = [
  {
    title: "Složky",
    icon: Folder,
    tint: "var(--c6)",
    text: "Vlastní strom. Barva, ikona a podsložky, jak se ti to hodí.",
    extra: <FolderPreview />,
  },
  {
    title: "Nástěnka",
    icon: Columns3,
    tint: "var(--c4)",
    text: "Seznam ve složce přepneš na sloupce. Stavy si pojmenuješ.",
    extra: <BoardPreview />,
  },
  {
    title: "Zadávání",
    icon: Mic,
    tint: "var(--c2)",
    text: "Diktuj, nebo piš jako větu. Zítra, v 9, lomítko je složka, mřížka štítek. Z mobilu jde úkol poslat rovnou sem.",
    extra: <AddPreview />,
  },
  {
    title: "Třídění",
    icon: Sparkles,
    tint: "var(--c14)",
    text: "Pravidlo zařadí podle textu nebo štítku. Bez pravidla složku jen navrhne, podle slov v názvu.",
    extra: <SortPreview />,
  },
  {
    title: "Kalendář",
    icon: CalendarDays,
    tint: "var(--c11)",
    text: "Termíny i plány na jednom místě. Den má svůj seznam. S Google Kalendářem se úkoly synchronizují oběma směry.",
    extra: <CalendarPreview />,
  },
  {
    title: "Poznámky",
    icon: StickyNote,
    tint: "var(--c3)",
    text: "Delší text s odrážkami. Ne jen další odškrtnutí.",
    extra: <NotesPreview />,
  },
  {
    title: "Na úkolu",
    icon: ListChecks,
    tint: "var(--c5)",
    text: "Volné termíny jako zítra nebo příští víkend. Opakování, lidé, priority, podúkoly a štítky.",
    extra: <TraitPreview />,
  },
  {
    title: "Tahání",
    icon: GripVertical,
    tint: "var(--c9)",
    text: "Pořadí, složka, den, štítek i koš. Chytíš a pustíš.",
  },
  {
    title: "Hledání",
    icon: Search,
    tint: "var(--c8)",
    text: "Jedna zkratka přes úkoly, poznámky i složky.",
  },
  {
    title: "Klávesnice",
    icon: Keyboard,
    tint: "var(--c16)",
    text: "Mezerník přidá, šipky vyberou, zpět vrátí poslední krok.",
  },
];

export function GuidePage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-10">
      <header>
        <p className="text-sm text-muted">Průvodce</p>
        <h1 className="mt-1 font-display text-3xl">Co Ordo umí</h1>
        <p className="mt-2 max-w-xl text-muted">
          Složky, do kterých si úkoly srovnáš sám. A věci, které to dělají samy.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <article
            key={card.title}
            className="rounded-xl border border-line bg-panel p-4"
          >
            <h2 className="flex items-center gap-2 font-display text-xl">
              <Mark icon={card.icon} tint={card.tint} />
              {card.title}
            </h2>
            {card.extra && (
              <div className="mt-3" aria-hidden="true">
                {card.extra}
              </div>
            )}
            <p className="mt-3 text-sm text-muted">{card.text}</p>
          </article>
        ))}
      </section>
      <article className="rounded-xl border border-line bg-raised px-4 py-4">
        <h2 className="flex items-center gap-2 font-display text-xl">
          <Mark icon={KeyRound} tint="var(--c9)" />
          Synchronizace
        </h2>
        <p className="mt-3 max-w-xl text-sm text-muted">
          Přes Evolu, až když ji zapneš. Kód ze slov je klíč, podobně jako seed:
          na dalším zařízení jím data otevřeš. Cestou jsou zašifrovaná, server
          je jen přenos a obsah nevidí.
        </p>
        <Link
          href="/settings"
          className="mt-3 inline-flex items-center rounded-md bg-black/[0.04] px-3 py-1.5 text-sm font-medium hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
        >
          Otevřít nastavení
        </Link>
      </article>
    </div>
  );
}

function Mark({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-md"
      style={{
        color: tint,
        background: `color-mix(in srgb, ${tint} 16%, transparent)`,
      }}
    >
      <Icon size={15} />
    </span>
  );
}

function FolderPreview() {
  const folders = [
    ["Doma", "var(--c6)"],
    ["Práce", "var(--c4)"],
    ["Cesty", "var(--c11)"],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {folders.map(([name, tint]) => (
        <span
          key={name}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 text-xs"
        >
          <span className="size-2 rounded-sm" style={{ background: tint }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function BoardPreview() {
  const columns = [
    { name: "Nové", color: "var(--status-todo)", item: "Mléko" },
    { name: "Dělám", color: "var(--status-doing)", item: "Zápis" },
    { name: "Hotovo", color: "var(--status-done)", item: "Nabídka" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {columns.map((column) => (
        <div
          key={column.name}
          className="rounded-lg border border-line bg-raised p-1.5"
        >
          <p className="mb-1.5 flex items-center gap-1 text-[11px] text-muted">
            <span
              className="size-1.5 rounded-full"
              style={{ background: column.color }}
            />
            {column.name}
          </p>
          <p className="truncate rounded-md border border-line bg-panel px-1.5 py-1 text-xs">
            {column.item}
          </p>
        </div>
      ))}
    </div>
  );
}

function AddPreview() {
  return (
    <p className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs">
      <span>vynést odpad</span>{" "}
      <span style={{ color: "var(--c6)" }}>/doma</span>{" "}
      <span className="text-muted">zítra v 18</span>
    </p>
  );
}

function SortPreview() {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2 py-1.5 text-xs">
      <span className="truncate">Objednat pytle</span>
      <span className="text-muted">→</span>
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span
          className="size-2 rounded-sm"
          style={{ background: "var(--c6)" }}
        />
        Doma
      </span>
    </p>
  );
}

function TraitPreview() {
  const traits = ["zítra", "týdně", "Jana", "vysoká", "#práce"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {traits.map((trait) => (
        <span
          key={trait}
          className="rounded-md border border-line bg-raised px-2 py-1 text-xs"
        >
          {trait}
        </span>
      ))}
    </div>
  );
}

function NotesPreview() {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 text-sm">
      <p>Vyrazit na hřebeny, dokud je světlo.</p>
      <p className="mt-1 text-muted">– svačina</p>
      <p className="text-muted">– mapa</p>
    </div>
  );
}

function CalendarPreview() {
  const days = ["Po", "Út", "St", "Čt", "Pá"];
  return (
    <div className="grid grid-cols-5 gap-1">
      {days.map((day, index) => (
        <div
          key={day}
          className="rounded-lg border border-line bg-raised px-1 py-1.5 text-center"
        >
          <p className="text-[11px] text-muted">{day}</p>
          <p className="text-sm">{20 + index}</p>
          {index === 1 ? (
            <p
              className="mt-1 truncate rounded px-0.5 text-[10px] leading-4"
              style={{
                color: "var(--c11)",
                background: "color-mix(in srgb, var(--c11) 16%, transparent)",
              }}
            >
              pas
            </p>
          ) : (
            <p className="mt-1 h-4" />
          )}
        </div>
      ))}
    </div>
  );
}
