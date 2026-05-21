import rehypeKatex from "rehype-katex";
import {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
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

async function writeTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the legacy execCommand path when Clipboard API is unavailable.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy failed");
  }
}

function resetCopyButtonLabel(button: HTMLButtonElement) {
  button.textContent = "复制";
  delete button.dataset.state;
}

function createResetTimer(button: HTMLButtonElement, timeoutIds: number[]) {
  const timeoutId = window.setTimeout(() => {
    resetCopyButtonLabel(button);
  }, 2000);

  timeoutIds.push(timeoutId);
}

function extractReactTextContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractReactTextContent).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(value)) {
    return extractReactTextContent(value.props.children);
  }

  return "";
}

function CopyCodeButton({ source }: { source: string }) {
  const [label, setLabel] = useState("复制");
  const [state, setState] = useState<"success" | "error" | undefined>(undefined);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  function scheduleReset() {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setLabel("复制");
      setState(undefined);
      resetTimeoutRef.current = null;
    }, 2000);
  }

  function handleCopy() {
    if (!source.trim()) {
      setLabel("无内容");
      setState("error");
      scheduleReset();
      return;
    }

    void writeTextToClipboard(source)
      .then(() => {
        setLabel("已复制");
        setState("success");
      })
      .catch(() => {
        setLabel("复制失败");
        setState("error");
      })
      .finally(() => {
        scheduleReset();
      });
  }

  return (
    <button type="button" className="story-code-copy" data-state={state} aria-label="复制代码" onClick={handleCopy}>
      {label}
    </button>
  );
}

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  children?: ReactNode;
};

function MarkdownPre({ node: _node, children, ...props }: MarkdownPreProps) {
  return (
    <div className="story-code-shell">
      <pre {...props}>{children}</pre>
      <CopyCodeButton source={extractReactTextContent(children)} />
    </div>
  );
}

function enhanceCodeBlocks(container: HTMLDivElement) {
  const timeoutIds: number[] = [];

  for (const pre of container.querySelectorAll<HTMLPreElement>("pre")) {
    if (pre.parentElement?.classList.contains("story-code-shell")) {
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "story-code-shell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-code-copy";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制代码");

    button.addEventListener("click", () => {
      const source = pre.textContent ?? "";
      if (!source.trim()) {
        button.textContent = "无内容";
        button.dataset.state = "error";
        createResetTimer(button, timeoutIds);
        return;
      }

      void writeTextToClipboard(source)
        .then(() => {
          button.textContent = "已复制";
          button.dataset.state = "success";
        })
        .catch(() => {
          button.textContent = "复制失败";
          button.dataset.state = "error";
        })
        .finally(() => {
          createResetTimer(button, timeoutIds);
        });
    });

    pre.parentElement?.insertBefore(wrapper, pre);
    wrapper.append(pre, button);
  }

  return () => {
    for (const timeoutId of timeoutIds) {
      window.clearTimeout(timeoutId);
    }
  };
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

  useEffect(() => {
    if (bodyFormat !== "html" || !contentRef.current) {
      return;
    }

    return enhanceCodeBlocks(contentRef.current);
  }, [body, bodyFormat]);

  if (bodyFormat === "html") {
    return <div ref={contentRef} className={cn("story-prose", className)} dangerouslySetInnerHTML={{ __html: body }} />;
  }

  return (
    <div ref={contentRef} className={cn("story-prose", className)}>
      <ReactMarkdown components={{ pre: MarkdownPre }} rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath, remarkGfm]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}