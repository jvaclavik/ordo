import type { ReactNode } from "react";
import { splitUrls } from "../domain/links.ts";

export function MarkdownLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function LinkedText({
  text,
  onActivate,
}: {
  text: string;
  onActivate?: (event: { stopPropagation: () => void }) => void;
}) {
  return splitUrls(text).map((part, index) =>
    part.kind === "url" ? (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
        onPointerDown={onActivate}
        onMouseDown={onActivate}
        onClick={onActivate}
      >
        {part.value}
      </a>
    ) : (
      <span key={index}>{part.value}</span>
    )
  );
}
