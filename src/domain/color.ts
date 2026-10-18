import { FOLDER_COLORS, type FolderColor } from "./types.ts";

export const DEFAULT_FOLDER_COLOR: FolderColor = "c4";

export type FolderPaint = FolderColor | `#${string}`;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isPaletteColor(color: string): color is FolderColor {
  return (FOLDER_COLORS as readonly string[]).includes(color);
}

export function normalizeFolderColor(color: string | null | undefined): FolderPaint | null {
  if (!color) return null;
  if (isPaletteColor(color)) return color;
  if (HEX.test(color)) return color.toLowerCase() as `#${string}`;
  return null;
}

export function paintCss(color: string | null | undefined): string {
  const paint = normalizeFolderColor(color);
  if (!paint) return `var(--${DEFAULT_FOLDER_COLOR})`;
  if (isPaletteColor(paint)) return `var(--${paint})`;
  return paint;
}
