import { Fragment, type ReactNode } from "react";

const defaultMarkClassName = "rounded px-1 bg-amber-100 text-amber-800";

function highlightTokens(query: string) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderHighlightedText(
  text: string | undefined | null,
  query: string | undefined | null,
  markClassName = defaultMarkClassName,
): ReactNode {
  const content = String(text ?? "");
  const normalizedQuery = query?.trim() ?? "";
  if (content.length === 0 || normalizedQuery.length === 0) {
    return content;
  }

  const tokens = highlightTokens(normalizedQuery);
  if (tokens.length === 0) {
    return content;
  }

  const tokenSet = new Set(tokens);
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  const parts = content.split(pattern);

  return parts.map((part, index) => {
    if (part.length === 0) {
      return null;
    }

    if (tokenSet.has(part.toLowerCase())) {
      return <mark key={`${part}-${index}`} className={markClassName}>{part}</mark>;
    }

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}
