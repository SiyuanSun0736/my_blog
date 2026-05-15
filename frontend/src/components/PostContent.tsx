import rehypeKatex from "rehype-katex";
import { useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { BodyFormat } from "../types";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface PostHeading {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4;
}

function slugifyHeading(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const slug = normalized
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function buildUniqueHeadingId(baseId: string, usedIds: Set<string>) {
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(nextId);
  return nextId;
}

function collectPostHeadings(container: HTMLDivElement): PostHeading[] {
  const usedIds = new Set<string>();

  return Array.from(container.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4")).flatMap((heading, index) => {
    const text = heading.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text.length === 0) {
      return [];
    }

    const fallbackId = `${slugifyHeading(text)}-${index + 1}`;
    const baseId = heading.id.trim() || fallbackId;
    const id = buildUniqueHeadingId(baseId, usedIds);
    if (heading.id !== id) {
      heading.id = id;
    }

    const level = Number(heading.tagName.slice(1));
    if (level < 1 || level > 4) {
      return [];
    }

    return [{
      id,
      text,
      level: level as PostHeading["level"],
    }];
  });
}

interface PostContentProps {
  body: string;
  bodyFormat?: BodyFormat;
  className?: string;
  onHeadingsChange?: (headings: PostHeading[]) => void;
}

export function PostContent({ body, bodyFormat = "markdown", className, onHeadingsChange }: PostContentProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headingsSignatureRef = useRef("");

  useLayoutEffect(() => {
    const headings = contentRef.current ? collectPostHeadings(contentRef.current) : [];
    const signature = JSON.stringify(headings);

    if (signature === headingsSignatureRef.current) {
      return;
    }

    headingsSignatureRef.current = signature;
    onHeadingsChange?.(headings);
  });

  if (bodyFormat === "html") {
    return <div ref={contentRef} className={cn("story-prose", className)} dangerouslySetInnerHTML={{ __html: body }} />;
  }

  return (
    <div ref={contentRef} className={cn("story-prose", className)}>
      <ReactMarkdown rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath, remarkGfm]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}