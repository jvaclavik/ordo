import { nanoid } from "nanoid";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { dispatch, useSnap } from "../data/store.tsx";
import {
  getSyncView,
  joinSync,
  setSyncEnabled,
  subscribeSync,
} from "../data/sync.ts";
import { isUntouched } from "../data/syncMap.ts";
import { todayKey } from "../domain/dates.ts";
import { alive, byId, inboxFolder, isValidDb } from "../domain/db.ts";
import { freshDb } from "../domain/reduce.ts";
import { orderedRules } from "../domain/rules.ts";
import { activeFolders } from "../domain/select.ts";
import type { Ctx } from "../domain/types.ts";
import { FolderPicker } from "./folderPick.tsx";
import { GcalPanel } from "./gcal.tsx";
import { loadDemo } from "./guide.tsx";
import { useUi } from "./state.tsx";
import { ThemeSwitch } from "./theme.tsx";
import { Button, control, Field, modLabel } from "./ui.tsx";

export function SettingsPage() {
  const { db } = useSnap();
  const ui = useUi();
  useEffect(() => {
    if (window.location.hash !== "#pravidla") return;
    document.getElementById("pravidla")?.scrollIntoView({ block: "start" });
  }, []);
  const archived = db.folders.filter(
    (folder) => !folder.isDeleted && folder.isArchived
  );
  return (
    <div className="grid max-w-2xl gap-8">
      <header>
        <h1 className="font-display text-3xl">Nastavení</h1>
        <p className="text-muted">
          Data zůstávají v tomhle prohlížeči. Synchronizaci mezi zařízeními
          zapneš níže.
        </p>
      </header>
      <SyncPanel />
      <GcalPanel />
      <section className="grid gap-3">
        <h2 className="font-display text-2xl">Vzhled</h2>
        <ThemeSwitch labeled />
      </section>
      <section className="grid gap-2">
        <h2 className="font-display text-2xl">Záloha</h2>
        <div className="flex flex-wrap gap-2">
          <Button tone="solid" onClick={() => download(db)}>
            Stáhnout JSON
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded-md px-3 py-1.5 text-sm hover:bg-black/5">
            Načíst JSON
            <input
              className="sr-only"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file
                  .text()
                  .then((text) => {
                    const data: unknown = JSON.parse(text);
                    if (!isValidDb(data)) {
                      ui.pushToast("Soubor není platná záloha.");
                      return;
                    }
                    dispatch({ type: "replaceDb", db: data });
                    ui.pushToast("Záloha je načtená.");
                  })
                  .catch(() => ui.pushToast("Soubor se nepodařilo přečíst."));
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <DataSection />
      <Rules />
      <section>
        <h2 className="mb-2 font-display text-2xl">Archiv</h2>
        {archived.length === 0 && (
          <p className="text-sm text-muted">Archiv je prázdný.</p>
        )}
        {archived.map((folder) => (
          <div
            key={folder.id}
            className="flex items-center justify-between py-1"
          >
            <span>{folder.name}</span>
            <Button
              onClick={() =>
                dispatch({
                  type: "updateFolder",
                  id: folder.id,
                  patch: { isArchived: false },
                })
              }
            >
              Vrátit
            </Button>
          </div>
        ))}
      </section>
      <section>
        <h2 className="mb-2 font-display text-2xl">Klávesy</h2>
        <ul className="grid gap-1 text-sm text-muted">
          <li>Mezerník nebo N přidá úkol</li>
          <li>{modLabel}K hledá. Šipky a Enter vyberou výsledek</li>
          <li>
            Enter potvrdí okno, {modLabel}Enter i z delšího textu. Escape okno
            zavře
          </li>
          <li>
            Šipky přepínají úkoly, Enter upraví název, Shift+Enter píše popis, X
            označí hotovo
          </li>
          <li>Shift nebo {modLabel} přidá další karty do výběru</li>
          <li>Delete přesune vybranou kartu do koše</li>
          <li>Alt+H přepne zobrazení skrytých složek</li>
          <li>
            {modLabel}Z vrací poslední krok, Shift+{modLabel}Z ho zopakuje
          </li>
          <li>
            V rychlém přidání lomítko našeptá složku a mřížka tag. Enter uloží,
            Alt+Enter nebo Shift+Enter přidá popis
          </li>
        </ul>
      </section>
      <p className="text-sm text-muted">
        Složek je {activeFolders(db).length}. Dnes je {todayKey()}.
      </p>
    </div>
  );
}

function SyncPanel() {
  const sync = useSyncExternalStore(subscribeSync, getSyncView, getSyncView);
  const ui = useUi();
  const [code, setCode] = useState("");
  const phase =
    sync.phase === "offline"
      ? "Teď bez spojení. Až se vrátí, zařízení si data znovu vymění."
      : sync.phase === "error"
      ? sync.detail ?? "Synchronizace se nepovedla."
      : sync.phase === "synced"
      ? "Synchronizováno. Kopie je v tomhle prohlížeči."
      : sync.mnemonic
      ? "Synchronizace běží."
      : "Synchronizace se připravuje.";
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-2xl">Synchronizace</h2>
      <p className="text-sm text-muted" role="status">
        {sync.enabled
          ? phase
          : "Vypnutá. Úkoly zůstávají jen v tomhle prohlížeči a nikam se neposílají."}
      </p>
      <Button
        tone={sync.enabled ? "ghost" : "solid"}
        aria-pressed={sync.enabled}
        onClick={() => setSyncEnabled(!sync.enabled)}
      >
        {sync.enabled ? "Vypnout synchronizaci" : "Zapnout synchronizaci"}
      </Button>
      {sync.enabled && (
        <>
          <p className="text-sm text-muted">
            Evolu HQ je jen přenos a jednou za čas se smaže. Úkoly zůstávají
            uložené na každém zařízení se stejným kódem. Po smazání si je
            zařízení při příštím otevření znovu nahrají a doplní si, co druhému
            chybí.
          </p>
          <Field label="Kód tohoto zařízení">
            <textarea
              className={control}
              readOnly
              rows={3}
              value={sync.mnemonic}
              aria-label="Synchronizační kód"
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <Button
            disabled={!sync.mnemonic}
            onClick={() => {
              void navigator.clipboard.writeText(sync.mnemonic).then(
                () => ui.pushToast("Kód je zkopírovaný"),
                () => ui.pushToast("Kód se nepodařilo zkopírovat")
              );
            }}
          >
            Kopírovat
          </Button>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const error = joinSync(code);
              if (error) ui.pushToast(error);
            }}
          >
            <Field label="Připojit jiné zařízení">
              <textarea
                className={control}
                rows={3}
                value={code}
                placeholder="Vlož kód z druhého zařízení"
                aria-label="Kód z druhého zařízení"
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Button type="submit">Připojit</Button>
          </form>
        </>
      )}
    </section>
  );
}

function wipeCtx(): Ctx {
  return {
    now: new Date().toISOString(),
    today: todayKey(),
    id: () => nanoid(10),
  };
}

function DataSection() {
  const { db } = useSnap();
  const ui = useUi();
  const inbox = inboxFolder(db);
  const empty = isUntouched(db);
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-2xl">Data</h2>
      <p className="text-sm text-muted">
        Ukázku naplníš, dokud je aplikace prázdná. Smazání vezme všechno v
        tomhle prohlížeči.
      </p>
      <div className="flex flex-wrap gap-2">
        {empty && inbox && (
          <Button
            tone="solid"
            onClick={() => {
              loadDemo(inbox.id);
              ui.pushToast("Ukázka je naplněná", true);
            }}
          >
            Naplň ukázkou
          </Button>
        )}
        <Button
          tone="danger"
          onClick={() =>
            ui.askConfirm({
              title: "Smazat všechna data?",
              body: "Úkoly, složky, štítky i pravidla v tomhle prohlížeči zmizí. Když běží synchronizace, smažou se i na ostatních zařízeních se stejným kódem. Zpět je vrátí, dokud aplikaci nezavřeš.",
              confirm: "Smazat",
              onConfirm: () =>
                dispatch({ type: "replaceDb", db: freshDb(wipeCtx()) }),
            })
          }
        >
          Smazat všechna data
        </Button>
        <Link
          href="/pruvodce"
          className="inline-flex items-center rounded-md bg-black/[0.04] px-3 py-1.5 text-sm font-medium hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10"
        >
          Co Ordo umí
        </Link>
      </div>
    </section>
  );
}

function download(db: unknown) {
  const blob = new Blob([JSON.stringify(db, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ukoly-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function Rules() {
  const { db } = useSnap();
  const folders = activeFolders(db).filter(
    (folder) => folder.system !== "inbox"
  );
  const tags = alive(db.tags);
  const inboxId = inboxFolder(db)?.id;
  const [text, setText] = useState("");
  const [tagId, setTagId] = useState("");
  const [folderId, setFolderId] = useState(folders[0]?.id ?? "");
  const rules = orderedRules(db);
  return (
    <section id="pravidla" className="grid scroll-mt-6 gap-3">
      <h2 className="font-display text-2xl">Pravidla pro nezařazené</h2>
      <p className="text-sm text-muted">
        Pravidla se použijí hned po uložení nebo přejmenování. Stačí text,
        štítek, nebo obojí. Když vyplníš obojí, musí sedět obojí. Návrh bez
        pravidla se jen nabídne.
      </p>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if ((!text.trim() && !tagId) || !folderId) return;
          dispatch({
            type: "createRule",
            id: nanoid(10),
            matchText: text.trim() || null,
            matchTagId: tagId || null,
            actionFolderId: folderId,
            actionStatusId: null,
            actionTagId: null,
          });
          setText("");
          setTagId("");
        }}
      >
        <Field label="Když text obsahuje">
          <input
            className={control}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="volitelné"
          />
        </Field>
        <Field label="Když má štítek">
          <select
            className={control}
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
          >
            <option value="">Nevyžadovat</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zařadit do">
          <FolderPicker
            value={folderId}
            excludeIds={inboxId ? [inboxId] : []}
            onPick={(id) => {
              if (id) setFolderId(id);
            }}
          />
        </Field>
        <Button tone="solid" type="submit" className="mt-1 w-fit">
          Přidat pravidlo
        </Button>
      </form>
      {rules.map((rule) => {
        const folder = byId(db.folders, rule.actionFolderId);
        const tag = byId(db.tags, rule.matchTagId);
        return (
          <div
            key={rule.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]"
          >
            <span className="text-sm">
              {[
                rule.matchText ? `„${rule.matchText}“` : null,
                tag ? `#${tag.name}` : null,
              ]
                .filter(Boolean)
                .join(" + ") || "Pravidlo"}{" "}
              → {folder?.name ?? "smazaná složka"}
            </span>
            <span className="flex gap-1">
              <Button
                onClick={() =>
                  dispatch({
                    type: "updateRule",
                    id: rule.id,
                    enabled: !rule.enabled,
                  })
                }
              >
                {rule.enabled ? "Vypnout" : "Zapnout"}
              </Button>
              <Button
                tone="danger"
                onClick={() => dispatch({ type: "deleteRule", id: rule.id })}
              >
                Smazat
              </Button>
            </span>
          </div>
        );
      })}
    </section>
  );
}
