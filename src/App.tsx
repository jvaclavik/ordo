import { useSnap } from "./data/store.tsx";
import { Shell } from "./ui/shell.tsx";
import { UiProvider } from "./ui/state.tsx";

export function App() {
  const snap = useSnap();
  if (!snap.ready) return <p className="grid min-h-dvh place-items-center text-muted">Načítám…</p>;
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}
