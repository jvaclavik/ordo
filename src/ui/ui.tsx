import { ChevronRight, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { priorityLabel } from "../domain/labels.ts";
import type { Priority } from "../domain/types.ts";

export const modLabel =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl+";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function priorityChip(priority: Priority | null, selected = false): { box: string; ink: string } {
  if (priority === "urgent") {
    return selected
      ? { box: "bg-danger", ink: "text-bg" }
      : { box: "bg-danger/15 hover:bg-danger/25", ink: "text-danger" };
  }
  if (priority === "high") {
    return selected
      ? { box: "bg-warn/30", ink: "text-warn" }
      : { box: "bg-warn/15 hover:bg-warn/25", ink: "text-warn" };
  }
  if (priority === "low") {
    return selected
      ? { box: "bg-black/10 dark:bg-white/15", ink: "text-ink" }
      : { box: "bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10", ink: "text-muted" };
  }
  return selected
    ? { box: "bg-accent-soft", ink: "text-accent" }
    : { box: "hover:bg-black/5 dark:hover:bg-white/10", ink: "text-muted" };
}

export function PriorityMark({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  const tone = priorityChip(priority, true);
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-medium leading-4",
        tone.box,
        tone.ink
      )}
    >
      {priorityLabel(priority)}
    </span>
  );
}

export function useDragDisplaced(dragging: boolean) {
  const [displaced, setDisplaced] = useState(false);
  useEffect(() => {
    if (!dragging) {
      setDisplaced(false);
      return;
    }
    const frame = requestAnimationFrame(() => setDisplaced(true));
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  return displaced;
}

export const control =
  "w-full rounded-md border border-transparent bg-black/[0.04] px-3 py-2 text-sm leading-5 text-ink outline-none placeholder:text-muted hover:bg-black/[0.07] focus:border-accent disabled:opacity-50 dark:bg-white/[0.06] dark:hover:bg-white/10";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "solid" | "ghost" | "danger" | "soft";
};

export function Button({
  tone = "ghost",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40",
        tone === "solid" && "bg-accent text-[var(--accent-ink)]",
        tone === "soft" && "bg-accent-soft text-accent",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "ghost" &&
          "bg-black/[0.04] hover:bg-black/10 dark:bg-white/[0.06] dark:hover:bg-white/10",
        className
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "grid size-9 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/10",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const layers: number[] = [];
let layerSeq = 0;

export function layerOpen() {
  return layers.length > 0;
}

export function useLayer(handler: (event: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const id = ++layerSeq;
    layers.push(id);
    const onKey = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== id) return;
      ref.current(event);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      const index = layers.indexOf(id);
      if (index >= 0) layers.splice(index, 1);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

const tabbable =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function trapTab(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const items = [...root.querySelectorAll<HTMLElement>(tabbable)];
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

function confirms(event: KeyboardEvent) {
  if (event.repeat || event.isComposing || event.defaultPrevented) return false;
  const command =
    (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
  const plain =
    !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (event.key !== "Enter" || (!command && !plain)) return false;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest("[data-primary]")) return true;
  if (target?.closest("button, a")) return false;
  if (!command && target?.closest("textarea, select, [contenteditable='true']"))
    return false;
  return true;
}

export function Dialog({
  title,
  onClose,
  onConfirm,
  onKeyDown,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer((event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    trapTab(event, ref.current);
    if (onConfirm && confirms(event)) {
      event.preventDefault();
      onConfirm();
    }
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const field = root.querySelector<HTMLElement>(
      "input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled])"
    );
    const primary = root.querySelector<HTMLElement>("[data-primary]");
    (field ?? primary ?? root).focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/30 p-0 sm:place-items-center sm:p-6"
      onMouseDown={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-raised p-5 shadow-[var(--shadow)] outline-none sm:rounded-lg",
          wide ? "sm:max-w-xl" : "sm:max-w-md"
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl leading-none">{title}</h2>
          <IconButton label="Zavřít" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export const hoverRow = "rounded-md hover:bg-black/5 dark:hover:bg-white/10";

export function OpenMark() {
  return <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />;
}

export function Disclosure({
  open,
  label,
  count,
  onClick,
}: {
  open: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cx(
        "flex w-full items-center gap-2 px-2 py-2 text-left text-sm",
        hoverRow
      )}
      onClick={onClick}
    >
      <ChevronRight
        size={16}
        className={cx(
          "shrink-0 text-muted transition-transform",
          open && "rotate-90"
        )}
      />
      <span className="font-medium">{label}</span>
      {count !== undefined && (
        <span className="rounded-sm bg-black/5 px-1.5 py-0.5 text-xs text-muted dark:bg-white/10">
          {count}
        </span>
      )}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
