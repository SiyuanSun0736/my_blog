import "katex/dist/katex.min.css";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import hljs from "highlight.js/lib/core";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { Mermaid } from "mermaid";
import rehypeKatex from "rehype-katex";
import { createPortal } from "react-dom";
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

const highlightLanguages = {
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  javascript,
  json,
  makefile,
  markdown,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

type HighlightLanguageName = keyof typeof highlightLanguages;

const highlightLanguageAliases: Record<string, HighlightLanguageName> = {
  "c++": "cpp",
  html: "xml",
  js: "javascript",
  md: "markdown",
  make: "makefile",
  mk: "makefile",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  svg: "xml",
  text: "plaintext",
  ts: "typescript",
  txt: "plaintext",
  yml: "yaml",
  zsh: "bash",
};

Object.entries(highlightLanguages).forEach(([name, language]) => {
  hljs.registerLanguage(name, language);
});

Object.entries(highlightLanguageAliases).forEach(([alias, languageName]) => {
  hljs.registerLanguage(alias, highlightLanguages[languageName]);
});

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

function escapeHTML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resolveCodeFenceLanguage(className?: string) {
  const match = className?.match(/language-([\w+-]+)/i);
  if (!match) {
    return undefined;
  }

  return match[1].toLowerCase();
}

function isMermaidLanguage(className?: string) {
  return resolveCodeFenceLanguage(className) === "mermaid";
}

function resolveCodeLanguage(className?: string): HighlightLanguageName | undefined {
  const normalizedName = resolveCodeFenceLanguage(className);
  if (!normalizedName) {
    return undefined;
  }

  if (normalizedName in highlightLanguages) {
    return normalizedName as HighlightLanguageName;
  }

  return highlightLanguageAliases[normalizedName];
}

function highlightCode(source: string, language: HighlightLanguageName | undefined) {
  if (!language) {
    return escapeHTML(source);
  }

  try {
    return hljs.highlight(source, { ignoreIllegals: true, language }).value;
  } catch {
    return escapeHTML(source);
  }
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

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  node?: unknown;
};

type CodeBlockChildProps = {
  children?: ReactNode;
  className?: string;
};

let mermaidRenderCounter = 0;
let isMermaidInitialized = false;
let mermaidModulePromise: Promise<Mermaid> | null = null;

const MERMAID_CACHE_PREFIX = "wanderlust-mermaid-v1-";
const mermaidMemoryCache = new Map<string, string>();

function hashMermaidSource(source: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const trimmed = source.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function getCachedMermaidSvg(source: string): string | null {
  const hash = hashMermaidSource(source);
  const inMemory = mermaidMemoryCache.get(hash);
  if (inMemory) {
    return inMemory;
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(MERMAID_CACHE_PREFIX + hash);
      if (stored) {
        mermaidMemoryCache.set(hash, stored);
        return stored;
      }
    } catch {
      // Storage error fallback
    }
  }

  return null;
}

function setCachedMermaidSvg(source: string, svg: string): void {
  const hash = hashMermaidSource(source);
  mermaidMemoryCache.set(hash, svg);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(MERMAID_CACHE_PREFIX + hash, svg);
    } catch {
      // If quota exceeded, clean oldest entries
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(MERMAID_CACHE_PREFIX)) {
            keysToRemove.push(k);
          }
        }
        for (let i = 0; i < Math.min(keysToRemove.length, 10); i++) {
          window.localStorage.removeItem(keysToRemove[i]);
        }
        window.localStorage.setItem(MERMAID_CACHE_PREFIX + hash, svg);
      } catch {
        // Ignore quota errors
      }
    }
  }
}

function preloadMermaid(): void {
  if (typeof window === "undefined" || mermaidModulePromise !== null) {
    return;
  }

  const idleCallback = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof idleCallback === "function") {
    idleCallback(() => {
      void loadMermaid();
    }, { timeout: 1500 });
  } else {
    window.setTimeout(() => {
      void loadMermaid();
    }, 150);
  }
}

async function loadMermaid() {
  mermaidModulePromise ??= import("mermaid").then((module) => module.default);

  const mermaid = await mermaidModulePromise;

  if (!isMermaidInitialized) {
    mermaid.initialize({
      securityLevel: "loose",
      startOnLoad: false,
      theme: "neutral",
      fontFamily: '"Space Grotesk", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif',
      fontSize: 14,
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
        padding: 16,
        nodeSpacing: 50,
        rankSpacing: 50,
      },
      themeVariables: {
        fontFamily: '"Space Grotesk", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif',
        fontSize: "14px",
      },
    });
    isMermaidInitialized = true;
  }

  return mermaid;
}

function formatMermaidError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0] || "Mermaid 图表语法无效。";
  }

  return "Mermaid 图表语法无效。";
}

interface MermaidModalProps {
  svg: string;
  onClose: () => void;
}

function MermaidModal({ svg, onClose }: MermaidModalProps) {
  const [scale, setScale] = useState(1.4);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    if (!contentRef.current) return;
    const svgEl = contentRef.current.querySelector("svg");
    if (!svgEl) return;

    const viewBox = svgEl.viewBox?.baseVal;
    let width = viewBox && viewBox.width > 0 ? viewBox.width : 0;
    let height = viewBox && viewBox.height > 0 ? viewBox.height : 0;

    if (!width || !height) {
      try {
        const bBox = svgEl.getBBox?.();
        if (bBox && bBox.width > 0 && bBox.height > 0) {
          width = bBox.width;
          height = bBox.height;
        }
      } catch {
        // ignore bBox error if detached
      }
    }

    if (!width || !height) {
      width = svgEl.getBoundingClientRect().width || 800;
      height = svgEl.getBoundingClientRect().height || 400;
    }

    // Explicitly set natural pixel dimensions so SVG never collapses
    svgEl.setAttribute("width", String(width));
    svgEl.setAttribute("height", String(height));
    svgEl.style.setProperty("width", `${width}px`, "important");
    svgEl.style.setProperty("height", `${height}px`, "important");
    svgEl.style.setProperty("max-width", "none", "important");
    svgEl.style.setProperty("max-height", "none", "important");

    const availableWidth = Math.max(window.innerWidth * 0.85, 360);
    const availableHeight = Math.max(window.innerHeight * 0.75, 260);

    const fitScale = Math.min(availableWidth / width, availableHeight / height);
    const initialScale = Math.min(Math.max(Number(fitScale.toFixed(2)), 0.6), 3.0);
    setScale(initialScale);
  }, [svg]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setScale((prev) => Math.min(Math.max(Number((prev * factor).toFixed(2)), 0.3), 6));
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...position };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setPosition({
      x: posStartRef.current.x + (e.clientX - dragStartRef.current.x),
      y: posStartRef.current.y + (e.clientY - dragStartRef.current.y),
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  const touchInfoRef = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
    initialDistance?: number;
    initialScale?: number;
  } | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchInfoRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        posX: position.x,
        posY: position.y,
      };
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchInfoRef.current = {
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        posX: position.x,
        posY: position.y,
        initialDistance: dist,
        initialScale: scale,
      };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchInfoRef.current) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setPosition({
        x: touchInfoRef.current.posX + (t.clientX - touchInfoRef.current.startX),
        y: touchInfoRef.current.posY + (t.clientY - touchInfoRef.current.startY),
      });
    } else if (e.touches.length === 2 && touchInfoRef.current.initialDistance && touchInfoRef.current.initialScale) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchInfoRef.current.initialDistance;
      setScale(Math.min(Math.max(Number((touchInfoRef.current.initialScale * factor).toFixed(2)), 0.3), 6));
    }
  }

  function handleTouchEnd() {
    touchInfoRef.current = null;
  }

  function zoomIn() {
    setScale((prev) => Math.min(Number((prev * 1.25).toFixed(2)), 6));
  }

  function zoomOut() {
    setScale((prev) => Math.max(Number((prev / 1.25).toFixed(2)), 0.3));
  }

  function resetZoom() {
    if (contentRef.current) {
      const svgEl = contentRef.current.querySelector("svg");
      const viewBox = svgEl?.viewBox?.baseVal;
      const w = (viewBox && viewBox.width > 0) ? viewBox.width : 800;
      const h = (viewBox && viewBox.height > 0) ? viewBox.height : 400;
      const fit = Math.min((window.innerWidth * 0.85) / w, (window.innerHeight * 0.75) / h);
      setScale(Math.min(Math.max(Number(fit.toFixed(2)), 0.6), 3.0));
    } else {
      setScale(1.0);
    }
    setPosition({ x: 0, y: 0 });
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setScale((prev) => (prev > 2.0 ? 1.3 : Number((prev * 1.5).toFixed(2))));
  }

  return createPortal(
    <div
      className="story-mermaid-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="story-mermaid-modal-backdrop" onClick={onClose} />

      <div
        className="story-mermaid-modal-viewport"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div
          ref={contentRef}
          className="story-mermaid-modal-content story-prose"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transition: isDragging ? "none" : "transform 120ms ease-out",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div className="story-mermaid-modal-toolbar">
        <span className="story-mermaid-modal-scale">{Math.round(scale * 100)}%</span>
        <button type="button" className="story-mermaid-modal-btn" title="缩小" onClick={zoomOut} aria-label="缩小">
          −
        </button>
        <button type="button" className="story-mermaid-modal-btn" title="重置" onClick={resetZoom} aria-label="重置">
          ↺
        </button>
        <button type="button" className="story-mermaid-modal-btn" title="放大" onClick={zoomIn} aria-label="放大">
          +
        </button>
        <button type="button" className="story-mermaid-modal-btn story-mermaid-modal-close" title="关闭 (ESC)" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cachedSvg = getCachedMermaidSvg(source);
  const [renderedSvg, setRenderedSvg] = useState<string | null>(cachedSvg);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const existingCached = getCachedMermaidSvg(source);
    if (existingCached) {
      setError(null);
      setRenderedSvg(existingCached);
      container.removeAttribute("data-state");
      container.innerHTML = existingCached;
      return;
    }

    let isActive = true;
    const diagramId = `story-mermaid-${++mermaidRenderCounter}`;

    setError(null);
    setRenderedSvg(null);
    container.removeAttribute("data-state");
    container.textContent = "图表渲染中...";

    void loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, source, container))
      .then(({ svg, bindFunctions }) => {
        if (!isActive || !containerRef.current) {
          return;
        }

        setCachedMermaidSvg(source, svg);
        setRenderedSvg(svg);
        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
      })
      .catch((renderError: unknown) => {
        if (!isActive || !containerRef.current) {
          return;
        }

        containerRef.current.textContent = "";
        containerRef.current.dataset.state = "error";
        setError(formatMermaidError(renderError));
      });

    return () => {
      isActive = false;
    };
  }, [source]);

  return (
    <>
      <div className="story-mermaid-shell">
        <div
          ref={containerRef}
          className="story-mermaid-diagram"
          aria-label="点击全屏放大 Mermaid 图表"
          title="点击全屏放大查看"
          onClick={() => {
            if (renderedSvg) {
              setIsModalOpen(true);
            }
          }}
        />
        {error ? (
          <div className="story-mermaid-error" role="alert">
            <p>{error}</p>
            <pre>
              <code>{source}</code>
            </pre>
          </div>
        ) : null}
      </div>
      {isModalOpen && renderedSvg ? (
        <MermaidModal svg={renderedSvg} onClose={() => setIsModalOpen(false)} />
      ) : null}
    </>
  );
}

function MarkdownCode({ node: _node, children, className, inline, ...props }: MarkdownCodeProps) {
  const language = resolveCodeLanguage(className);

  if (inline || !language) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  const source = extractReactTextContent(children).replace(/\n$/, "");

  return (
    <code
      {...props}
      className={cn("hljs", language ? `language-${language}` : undefined, className)}
      dangerouslySetInnerHTML={{ __html: highlightCode(source, language) }}
    />
  );
}

function MarkdownPre({ node: _node, children, ...props }: MarkdownPreProps) {
  if (isValidElement<CodeBlockChildProps>(children) && isMermaidLanguage(children.props.className)) {
    return <MermaidDiagram source={extractReactTextContent(children.props.children).replace(/\n$/, "")} />;
  }

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
    if (bodyFormat === "markdown" && body.includes("mermaid")) {
      preloadMermaid();
    }
  }, [body, bodyFormat]);

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
      <ReactMarkdown
        components={{ code: MarkdownCode, pre: MarkdownPre }}
        rehypePlugins={[rehypeKatex]}
        remarkPlugins={[remarkMath, remarkGfm]}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
