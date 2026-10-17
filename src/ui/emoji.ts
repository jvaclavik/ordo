export function folderEmoji(text: string): string | null {
  const segmenter = new Intl.Segmenter("cs", { granularity: "grapheme" });
  const found = [...segmenter.segment(text)]
    .map((part) => part.segment)
    .filter((part) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(part));
  return found.at(-1) ?? null;
}
