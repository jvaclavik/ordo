import type { ReactNode } from "react";
import { splitLinks } from "../domain/links.ts";

export function MarkdownLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const blank = Boolean(href && /^https?:/i.test(href));
  return (
    <a href={href} {...(blank ? { target: "_blank", rel: "noreferrer" } : {})}>
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
  return splitLinks(text).map((part, index) =>
    part.kind === "text" ? (
      <span key={index}>{part.value}</span>
    ) : (
      <a
        key={index}
        href={part.href}
        {...(part.kind === "url"
          ? { target: "_blank", rel: "noreferrer" }
          : {})}
        className="underline underline-offset-2"
        onPointerDown={onActivate}
        onMouseDown={onActivate}
        onClick={onActivate}
      >
        {part.value}
      </a>
    )
  );
}
