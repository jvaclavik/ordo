import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cx } from "./ui.tsx";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "ukoly-theme";

const options = [
  { id: "light", label: "Světlý", icon: Sun },
  { id: "system", label: "Podle systému", icon: Monitor },
  { id: "dark", label: "Tmavý", icon: Moon },
] as const;

function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* úložiště nemusí být dostupné */
  }
  return "system";
}

function resolvedDark(theme: ThemeChoice) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeChoice) {
  const dark = resolvedDark(theme);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#161514" : "#f4f3f0");
}

let theme = readTheme();
const listeners = new Set<() => void>();

function getTheme() {
  return theme;
}

export function setTheme(next: ThemeChoice) {
  theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* volba platí aspoň do obnovení stránky */
  }
  applyTheme(next);
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    getTheme,
    getTheme,
  );
}

export function ThemeSync() {
  const current = useTheme();
  useEffect(() => {
    applyTheme(current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [current]);
  return null;
}

export function ThemeSwitch({ labeled = false }: { labeled?: boolean }) {
  const current = useTheme();
  return (
    <div
      role="group"
      aria-label="Vzhled"
      className="flex rounded-md bg-black/5 p-0.5 dark:bg-white/10"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const on = current === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            aria-label={option.label}
            title={option.label}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 rounded-sm",
              labeled ? "px-3 py-1.5 text-sm" : "size-8",
              on ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
            onClick={() => setTheme(option.id)}
          >
            <Icon size={15} />
            {labeled ? option.label : null}
          </button>
        );
      })}
    </div>
  );
}
