export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function foldWithMap(value: string): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const folded = value[index]!.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const char of folded) {
      text += char;
      starts.push(index);
    }
  }
  return { text, starts };
}

export function originalSpan(
  source: string,
  starts: number[],
  from: number,
  to: number,
): { start: number; end: number } {
  const start = starts[from] ?? source.length;
  const end = to < starts.length ? starts[to]! : source.length;
  return { start, end };
}

export function words(value: string): string[] {
  return fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

export function includesFold(haystack: string, needle: string): boolean {
  const query = fold(needle).trim();
  if (!query) return false;
  return fold(haystack).includes(query);
}
