import {
  AppName,
  String as EvoluString,
  Mnemonic,
  NonEmptyTrimmedString100,
  createAppOwner,
  createEvolu,
  createIdFromString,
  createOwnerSecret,
  createQueryBuilder,
  createRandomBytes,
  createRun,
  id,
  maxLength,
  maxMutationSize,
  mnemonicToOwnerSecret,
  sqliteTrue,
  type Evolu,
} from "@evolu/common";
import { createEvoluDeps } from "@evolu/react-web";
import type { Db } from "../domain/types.ts";
import {
  collapseInboxes,
  dbFromRows,
  fingerprint,
  isUntouched,
  mergeLatest,
  rowsFromDb,
  type SyncRow,
} from "./syncMap.ts";

const SyncSchema = {
  doc: {
    id: id("Doc"),
    kind: NonEmptyTrimmedString100,
    appId: NonEmptyTrimmedString100,
    payload: maxLength(100_000)(EvoluString),
  },
};

const appName = AppName.orThrow("ordo");
const createQuery = createQueryBuilder(SyncSchema);
const docsQuery = createQuery((db) =>
  db.selectFrom("doc").select(["id", "kind", "appId", "payload", "isDeleted"])
);

const mnemonicKey = "ordo-sync-mnemonic";
const enabledKey = "ordo-sync-enabled";

export type SyncView = {
  enabled: boolean;
  mnemonic: string;
  phase: "idle" | "syncing" | "synced" | "offline" | "error";
  detail: string | null;
};

const listeners = new Set<() => void>();
let view: SyncView = {
  enabled: syncPreference(),
  mnemonic: "",
  phase: "idle",
  detail: null,
};
let evolu: Evolu<typeof SyncSchema> | null = null;
let deps: ReturnType<typeof createEvoluDeps> | null = null;
let written = new Map<string, string>();
let onRemote: ((db: Db) => void) | null = null;
let readLocal: (() => Db) | null = null;
let unlistenQuery: (() => void) | null = null;
let unlistenStatus: (() => void) | null = null;
let pushEnabled = false;
let acceptRemote = false;
let session = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function getSyncView() {
  return view;
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setView(patch: Partial<SyncView>) {
  view = { ...view, ...patch };
  emit();
}

function syncPreference(): boolean {
  try {
    return localStorage.getItem(enabledKey) === "1";
  } catch {
    return false;
  }
}

function saveSyncPreference(on: boolean) {
  localStorage.setItem(enabledKey, on ? "1" : "0");
}

function storedMnemonic(): string | null {
  try {
    return localStorage.getItem(mnemonicKey);
  } catch {
    return null;
  }
}

function saveMnemonic(mnemonic: string) {
  localStorage.setItem(mnemonicKey, mnemonic);
}

function ownerFromMnemonic(mnemonic: string) {
  const parsed = Mnemonic.fromUnknown(mnemonic);
  if (!parsed.ok) return null;
  return createAppOwner(mnemonicToOwnerSecret(parsed.value));
}

function loadOwner() {
  const existing = storedMnemonic();
  if (existing) {
    const owner = ownerFromMnemonic(existing);
    if (owner) return owner;
  }
  const created = createAppOwner(
    createOwnerSecret({ randomBytes: createRandomBytes() })
  );
  saveMnemonic(created.mnemonic);
  return created;
}

function stableId(kind: string, appId: string) {
  return SyncSchema.doc.id.orThrow(createIdFromString(`${kind}:${appId}`));
}

function asRows(
  raw: ReadonlyArray<{
    kind: string | null;
    appId: string | null;
    payload: string | null;
    isDeleted: 0 | 1 | null;
  }>
): SyncRow[] {
  const rows: SyncRow[] = [];
  for (const row of raw) {
    if (!row.kind || !row.appId || row.payload == null) continue;
    if (row.isDeleted === 1) {
      rows.push({
        kind: row.kind as SyncRow["kind"],
        appId: row.appId,
        payload: row.payload,
        deleted: true,
      });
      continue;
    }
    rows.push({
      kind: row.kind as SyncRow["kind"],
      appId: row.appId,
      payload: row.payload,
      deleted: false,
    });
  }
  return rows;
}

function remember(rows: readonly SyncRow[]) {
  written = new Map();
  for (const row of rows) {
    if (row.deleted) continue;
    written.set(`${row.kind}:${row.appId}`, row.payload);
  }
}

function publish(rows: readonly SyncRow[]) {
  if (!acceptRemote) return;
  const db = dbFromRows(rows);
  if (!db || !onRemote) return;
  remember(rows);
  onRemote(db);
}

function readRows() {
  if (!evolu) return [];
  return asRows(evolu.getQueryRows(docsQuery));
}

function writeDiff(db: Db) {
  if (!evolu) return;
  const next = new Map<string, string>();
  for (const row of rowsFromDb(db)) {
    const key = `${row.kind}:${row.appId}`;
    next.set(key, row.payload);
    if (written.get(key) === row.payload) continue;
    if (row.payload.length > 100_000) {
      setView({
        phase: "error",
        detail: "Jedna položka je moc velká a nesynchronizovala se.",
      });
      continue;
    }
    const values = {
      id: stableId(row.kind, row.appId),
      kind: NonEmptyTrimmedString100.orThrow(row.kind),
      appId: NonEmptyTrimmedString100.orThrow(row.appId),
      payload: SyncSchema.doc.payload.orThrow(row.payload),
    };
    if (evolu.getMutationSize("doc", values) > maxMutationSize) {
      setView({
        phase: "error",
        detail: "Jedna položka je moc velká a nesynchronizovala se.",
      });
      continue;
    }
    evolu.upsert("doc", values);
    written.set(key, row.payload);
  }
  for (const key of written.keys()) {
    if (next.has(key)) continue;
    const split = key.indexOf(":");
    const kind = key.slice(0, split);
    const appId = key.slice(split + 1);
    evolu.update("doc", { id: stableId(kind, appId), isDeleted: sqliteTrue });
    written.delete(key);
  }
}

export function noteLocal(db: Db) {
  if (!pushEnabled || !evolu) return;
  try {
    writeDiff(db);
  } catch (error) {
    if (!pushEnabled || !evolu) return;
    setView({
      phase: "error",
      detail:
        error instanceof Error ? error.message : "Synchronizace se nepovedla.",
    });
  }
}

function refreshStatus() {
  if (!syncPreference() || !evolu || !deps) return;
  const state = deps.syncState.get();
  const transports = (state?.transports ?? []) as Array<{
    connection: { type: string };
  }>;
  const connections = transports.map((transport) => transport.connection.type);
  if (connections.length === 0) {
    setView({ phase: "syncing", detail: null });
    return;
  }
  if (connections.every((type) => type === "Disconnected")) {
    setView({
      phase: "offline",
      detail:
        "Bez spojení. Data jsou na tomto zařízení a odešlou se, až se spojení vrátí.",
    });
    return;
  }
  if (connections.some((type) => type === "Open")) {
    setView({ phase: "synced", detail: null });
    return;
  }
  setView({ phase: "syncing", detail: null });
}

function request() {
  if (!evolu) return;
  evolu.requestSync(evolu.appOwner.id);
}

function mergeLocal(local: Db) {
  if (!evolu || isUntouched(local)) return;
  const base = dbFromRows(readRows());
  const merged = base ? collapseInboxes(mergeLatest(base, local)) : local;
  if (base && fingerprint(merged) === fingerprint(base)) return;
  writeDiff(merged);
  publish(readRows());
}

let opening = false;
let watching = false;

function watchNetwork(readLocal: () => Db, apply: (db: Db) => void) {
  if (watching) return;
  watching = true;
  const again = () => {
    if (!syncPreference()) return;
    if (evolu) request();
    else void startSync(readLocal, apply);
  };
  window.addEventListener("online", again);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") again();
  });
  window.setInterval(again, 60_000);
}

async function disposeEvolu(instance: Evolu<typeof SyncSchema>) {
  const token = (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose;
  if (!token) return;
  const dispose = (instance as unknown as Record<symbol, () => Promise<void>>)[
    token
  ];
  if (dispose) await dispose.call(instance);
}

async function stopSync() {
  session += 1;
  pushEnabled = false;
  acceptRemote = false;
  unlistenQuery?.();
  unlistenQuery = null;
  unlistenStatus?.();
  unlistenStatus = null;
  const current = evolu;
  evolu = null;
  written = new Map();
  setView({ enabled: false, mnemonic: "", phase: "idle", detail: null });
  if (current) await disposeEvolu(current);
}

export function setSyncEnabled(on: boolean) {
  try {
    saveSyncPreference(on);
  } catch {
    setView({
      phase: "error",
      detail: "Nastavení se nepodařilo uložit.",
    });
    return;
  }
  if (!on) {
    void stopSync();
    return;
  }
  setView({ enabled: true, phase: "syncing", detail: null });
  if (readLocal && onRemote) void startSync(readLocal, onRemote);
}

export async function startSync(read: () => Db, apply: (db: Db) => void) {
  readLocal = read;
  onRemote = apply;
  if (!syncPreference()) return;
  const ticket = session;
  watchNetwork(read, apply);
  if (evolu || opening) {
    request();
    return;
  }
  opening = true;
  try {
    deps ??= createEvoluDeps();
    const owner = loadOwner();
    const run = createRun(deps);
    const created = await run.ok(
      createEvolu(SyncSchema, {
        appName,
        appOwner: owner,
      })
    );
    if (ticket !== session || !syncPreference()) {
      await disposeEvolu(created);
      return;
    }
    evolu = created;
    saveMnemonic(evolu.appOwner.mnemonic);
    setView({
      enabled: true,
      mnemonic: evolu.appOwner.mnemonic,
      phase: "syncing",
      detail: null,
    });
    unlistenStatus = deps.syncState.subscribe(refreshStatus);
    await evolu.loadQuery(docsQuery);
    if (ticket !== session || !syncPreference()) return;
    remember(readRows());
    unlistenQuery = evolu.subscribeQuery(docsQuery)(() => {
      publish(readRows());
    });
    acceptRemote = true;
    pushEnabled = true;
    const initial = dbFromRows(readRows());
    if (initial) apply(initial);
    else mergeLocal(read());
    request();
    refreshStatus();
  } catch (error) {
    if (ticket !== session || !syncPreference()) return;
    setView({
      enabled: true,
      phase: navigator.onLine ? "error" : "offline",
      detail: navigator.onLine
        ? error instanceof Error
          ? error.message
          : "Synchronizace se nepovedla."
        : "Bez spojení. Data jsou na tomto zařízení a odešlou se, až se spojení vrátí.",
    });
  } finally {
    opening = false;
  }
}

export function joinSync(mnemonic: string): string | null {
  const owner = ownerFromMnemonic(mnemonic.trim());
  if (!owner) return "Kód není platný.";
  if (owner.mnemonic === view.mnemonic)
    return "Tohle zařízení už tenhle kód používá.";
  saveMnemonic(owner.mnemonic);
  window.location.reload();
  return null;
}
