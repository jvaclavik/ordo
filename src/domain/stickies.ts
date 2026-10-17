export const STICKY_W = 232;
export const STICKY_H = 168;
export const STICKY_GAP = 16;
export const STICKY_PAD = 4;
export const STICKY_MIN_W = 168;
export const STICKY_MIN_H = 120;
export const STICKY_MAX_W = 560;
export const STICKY_MAX_H = 720;

export const STICKY_PAPERS = [
  { bg: "#f4e4a6", edge: "#e6cf7c" },
  { bg: "#f7d4b8", edge: "#e8bc96" },
  { bg: "#d7e7cb", edge: "#bdd4ae" },
  { bg: "#d5e3f6", edge: "#b7cceb" },
  { bg: "#f6d5de", edge: "#e7b8c6" },
] as const;

export function stickyColumns(width: number) {
  return Math.max(1, Math.floor((width - STICKY_PAD) / (STICKY_W + STICKY_GAP)));
}

export function stickySlot(index: number, columns: number) {
  const cols = Math.max(1, columns);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: STICKY_PAD + col * (STICKY_W + STICKY_GAP),
    y: STICKY_PAD + row * (STICKY_H + STICKY_GAP),
  };
}

function hashId(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stickyPaper(id: string) {
  return STICKY_PAPERS[hashId(id) % STICKY_PAPERS.length] ?? STICKY_PAPERS[0];
}

export function clampStickySize(width: number, height: number) {
  return {
    width: Math.round(Math.min(STICKY_MAX_W, Math.max(STICKY_MIN_W, width))),
    height: Math.round(Math.min(STICKY_MAX_H, Math.max(STICKY_MIN_H, height))),
  };
}

export function stickyTilt(id: string) {
  return ((hashId(id) % 7) - 3) * 0.7;
}
