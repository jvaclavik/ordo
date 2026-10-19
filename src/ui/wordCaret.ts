const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

const textTypes = new Set(["text", "search", "url", "tel", "password", "email"]);

export function wordJumpTarget(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && textTypes.has(target.type)) return target;
  return null;
}

export function wordBoundary(text: string, index: number, direction: 1 | -1): number {
  const from = Math.max(0, Math.min(index, text.length));
  if (direction === 1) {
    for (const part of segmenter.segment(text)) {
      if (!part.isWordLike) continue;
      const end = part.index + part.segment.length;
      if (end > from) return end;
    }
    return text.length;
  }
  let start = 0;
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    if (part.index >= from) break;
    start = part.index;
  }
  return start;
}

export function rangeAfterWordJump(
  text: string,
  start: number,
  end: number,
  direction: 1 | -1,
  extend: boolean,
  selectionDirection: "forward" | "backward" | "none",
): { start: number; end: number; direction: "forward" | "backward" | "none" } {
  if (!extend) {
    const origin = direction === 1 ? end : start;
    const next = wordBoundary(text, origin, direction);
    return { start: next, end: next, direction: "none" };
  }
  const backward = selectionDirection === "backward";
  const anchor = backward ? end : start;
  const focus = backward ? start : end;
  const next = wordBoundary(text, focus, direction);
  return {
    start: Math.min(anchor, next),
    end: Math.max(anchor, next),
    direction: next < anchor ? "backward" : next > anchor ? "forward" : "none",
  };
}

export function jumpWordInField(
  field: HTMLInputElement | HTMLTextAreaElement,
  direction: 1 | -1,
  extend: boolean,
) {
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (start === null || end === null) return;
  const next = rangeAfterWordJump(
    field.value,
    start,
    end,
    direction,
    extend,
    field.selectionDirection ?? "none",
  );
  field.setSelectionRange(next.start, next.end, next.direction);
}
