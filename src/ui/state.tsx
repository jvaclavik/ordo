import { nanoid } from "nanoid";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type QuickState = {
  folderId: string | null;
  statusId: string | null;
  text: string;
};
export type FolderEdit = { id: string | null; parentId: string | null };
export type ConfirmState = {
  title: string;
  body: string;
  confirm: string;
  alt?: string;
  onConfirm: () => void;
  onAlt?: () => void;
};
export type ChoiceState = {
  title: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
};
export type Toast = { id: string; text: string; undo: boolean };

type Ui = {
  selectedId: string | null;
  select: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  quick: QuickState | null;
  openQuick: (prefill?: Partial<QuickState>) => void;
  closeQuick: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  folderEdit: FolderEdit | null;
  setFolderEdit: (edit: FolderEdit | null) => void;
  confirm: ConfirmState | null;
  askConfirm: (value: ConfirmState) => void;
  closeConfirm: () => void;
  choice: ChoiceState | null;
  askChoice: (value: ChoiceState) => void;
  closeChoice: () => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  picked: string[];
  showDone: boolean;
  setShowDone: (value: boolean) => void;
  toggleInSelection: (id: string) => void;
  selectRange: (id: string, orderedIds: string[]) => void;
  clearPicked: () => void;
  editingBodyId: string | null;
  editBody: (id: string | null) => void;
  toasts: Toast[];
  pushToast: (text: string, undo?: boolean) => void;
};

const Context = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quick, setQuick] = useState<QuickState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [folderEdit, setFolderEdit] = useState<FolderEdit | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(readShowDone);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editingBodyId, setEditingBodyId] = useState<string | null>(null);

  const api = useMemo<Ui>(() => {
    const pushToast = (text: string, undo = false) => {
      const id = nanoid(6);
      setToasts((current) => [...current, { id, text, undo }]);
      window.setTimeout(
        () =>
          setToasts((current) => current.filter((toast) => toast.id !== id)),
        4200
      );
    };
    return {
      selectedId,
      select: (id) => {
        setPicked([]);
        setEditingBodyId(null);
        setSelectedId((current) => (id !== null && current === id ? null : id));
      },
      setSelected: (id) => {
        setPicked([]);
        setEditingBodyId(null);
        setSelectedId(id);
      },
      quick,
      openQuick: (prefill) =>
        setQuick({
          folderId: prefill?.folderId ?? null,
          statusId: prefill?.statusId ?? null,
          text: prefill?.text ?? "",
        }),
      closeQuick: () => setQuick(null),
      searchOpen,
      setSearchOpen,
      folderEdit,
      setFolderEdit,
      confirm,
      askConfirm: setConfirm,
      closeConfirm: () => setConfirm(null),
      choice,
      askChoice: setChoice,
      closeChoice: () => setChoice(null),
      menuOpen,
      setMenuOpen,
      picked,
      showDone,
      setShowDone: (value) => {
        setShowDone(value);
        try {
          sessionStorage.setItem("ukoly-show-done", value ? "1" : "0");
        } catch {
          return;
        }
      },
      toggleInSelection: (id) => {
        const base =
          picked.length > 0 ? picked : selectedId ? [selectedId] : [];
        const next = base.includes(id)
          ? base.filter((item) => item !== id)
          : [...base, id];
        if (next.length <= 1) {
          setPicked([]);
          setSelectedId(next[0] ?? null);
          return;
        }
        const anchor =
          selectedId && next.includes(selectedId)
            ? selectedId
            : next[0] ?? null;
        setPicked(next);
        setSelectedId(anchor);
      },
      selectRange: (id, orderedIds) => {
        const anchor =
          selectedId && orderedIds.includes(selectedId) ? selectedId : null;
        const end = orderedIds.indexOf(id);
        if (!anchor || end < 0) {
          setPicked([]);
          setSelectedId(id);
          return;
        }
        const start = orderedIds.indexOf(anchor);
        const range = orderedIds.slice(
          Math.min(start, end),
          Math.max(start, end) + 1
        );
        if (range.length <= 1) {
          setPicked([]);
          setSelectedId(id);
          return;
        }
        setPicked(range);
        setSelectedId(anchor);
      },
      clearPicked: () => setPicked([]),
      editingBodyId,
      editBody: (id) => {
        setEditingBodyId(id);
        if (!id) return;
        setPicked([]);
        setSelectedId(id);
      },
      toasts,
      pushToast,
    };
  }, [
    selectedId,
    quick,
    searchOpen,
    folderEdit,
    confirm,
    choice,
    menuOpen,
    picked,
    showDone,
    toasts,
    editingBodyId,
  ]);

  return <Context value={api}>{children}</Context>;
}

function readShowDone() {
  try {
    return sessionStorage.getItem("ukoly-show-done") === "1";
  } catch {
    return false;
  }
}

export function useUi() {
  const value = useContext(Context);
  if (!value) throw new Error("Chybí rozhraní aplikace.");
  return value;
}
