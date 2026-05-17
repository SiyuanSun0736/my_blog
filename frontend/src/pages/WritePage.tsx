import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner } from "../components/ui";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { load as parseYAML } from "js-yaml";
import { Link } from "react-router-dom";
import {
  batchPosts,
  createPost,
  deletePost,
  fetchAdminPost,
  fetchAdminPosts,
  importHTMLDocument,
  setPostFeatured,
  uploadImage,
  updatePost,
  verifyWriteAccess,
  type BatchPostsAction,
  type HTMLImportResponse,
} from "../lib/api";
import { normalizeLatexInBody } from "../lib/latex";
import type { BodyFormat, Post, PostSummary } from "../types";

interface WriteFormState {
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string;
  author: string;
  publishedAt: string;
  accent: string;
  bodyFormat: BodyFormat;
  body: string;
  draft: boolean;
  featured: boolean;
}

interface MetadataChange {
  label: string;
  before: string;
  after: string;
}

interface DiffLine {
  kind: "add" | "remove";
  text: string;
}

interface AutosaveSnapshot {
  form: WriteFormState;
  importedFileName: string | null;
  savedAt: string;
}

interface PreparedUploadImage {
  file: File;
  originalBytes: number;
  compressed: boolean;
}

const defaultAccent = "linear-gradient(135deg, #0f766e 0%, #f59e0b 100%)";
const writeTokenStorageKey = "wanderlust:write-token";
const autosaveStorageKeyPrefix = "wanderlust:admin-autosave:v1";
const defaultBody = "# 新记录标题\n\n先写问题背景，再补关键指标、命令、日志或代码片段。";
const maxUploadImageSizeBytes = 8 * 1024 * 1024;
const autoCompressibleImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageCompressionScaleSteps = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
const imageCompressionQualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

const batchActionLabels: Record<BatchPostsAction, string> = {
  publish: "发布",
  draft: "转为草稿",
  delete: "删除",
};

function createEmptyFormState(): WriteFormState {
  return {
    title: "",
    slug: "",
    summary: "",
    category: "Compiler / Systems",
    tags: "",
    author: "Wanderlust",
    publishedAt: new Date().toISOString().slice(0, 10),
    accent: defaultAccent,
    bodyFormat: "markdown",
    body: defaultBody,
    draft: true,
    featured: false,
  };
}

function formStateFromPost(post: Post): WriteFormState {
  return {
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    category: post.category,
    tags: post.tags.join(", "),
    author: post.author,
    publishedAt: post.publishedAt,
    accent: post.accent,
    bodyFormat: post.bodyFormat === "html" ? "html" : "markdown",
    body: post.body,
    draft: post.draft,
    featured: post.featured,
  };
}

function normalizeBodyFormat(value: BodyFormat | string | undefined | null): BodyFormat {
  return value === "html" ? "html" : "markdown";
}

function normalizeWriteFormState(form: Partial<WriteFormState>): WriteFormState {
  const defaults = createEmptyFormState();

  return {
    ...defaults,
    ...form,
    bodyFormat: normalizeBodyFormat(form.bodyFormat),
  };
}

interface FrontmatterData {
  title?: string;
  slug?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  author?: string;
  publishedAt?: string;
  accent?: string;
  draft?: boolean;
  featured?: boolean;
}

function normalizeMarkdownLineEndings(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

type FrontmatterSource = Record<string, unknown>;

function isFrontmatterSource(value: unknown): value is FrontmatterSource {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFrontmatterKey(value: string) {
  return value.replace(/[_\-\s]+/g, "").toLowerCase();
}

function collectFrontmatterMatches(
  source: FrontmatterSource,
  targetKeys: string[],
  visited = new Set<FrontmatterSource>(),
): unknown[] {
  if (visited.has(source)) {
    return [];
  }

  visited.add(source);
  const normalizedTargets = new Set(targetKeys.map(normalizeFrontmatterKey));
  const matches: unknown[] = [];

  Object.entries(source).forEach(([key, value]) => {
    if (normalizedTargets.has(normalizeFrontmatterKey(key))) {
      matches.push(value);
    }

    if (isFrontmatterSource(value)) {
      matches.push(...collectFrontmatterMatches(value, targetKeys, visited));
    }
  });

  return matches;
}

function findFrontmatterValue(source: FrontmatterSource, keys: string[]) {
  return collectFrontmatterMatches(source, keys).find((value) => value !== undefined && value !== null);
}

function formatFrontmatterDate(value: Date) {
  if (Number.isNaN(value.getTime())) {
    return undefined;
  }

  return value.toISOString().slice(0, 10);
}

function normalizeFrontmatterText(value: unknown) {
  if (value instanceof Date) {
    return formatFrontmatterDate(value);
  }

  if (typeof value === "string") {
    const normalized = normalizeMarkdownLineEndings(value).trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function normalizeFrontmatterInlineText(value: unknown) {
  const normalized = normalizeFrontmatterText(value);
  if (!normalized) {
    return undefined;
  }

  const flattened = normalized.replace(/\s+/g, " ").trim();
  return flattened.length > 0 ? flattened : undefined;
}

function normalizeFrontmatterBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

function normalizeFrontmatterTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value
      .flatMap((entry) => normalizeFrontmatterTags(entry) ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean);

    return tags.length > 0 ? tags : undefined;
  }

  const normalized = normalizeFrontmatterInlineText(value);
  if (!normalized) {
    return undefined;
  }

  const tags = normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return tags.length > 0 ? tags : undefined;
}

function normalizeFrontmatterData(source: FrontmatterSource): FrontmatterData {
  return {
    title: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["title"])),
    slug: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["slug"])),
    summary: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["summary", "description"])),
    category: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["category"])),
    tags: normalizeFrontmatterTags(findFrontmatterValue(source, ["tags", "keywords"])),
    author: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["author"])),
    publishedAt: normalizeFrontmatterText(findFrontmatterValue(source, ["publishedAt", "published_at", "date"])),
    accent: normalizeFrontmatterInlineText(findFrontmatterValue(source, ["accent"])),
    draft: normalizeFrontmatterBoolean(findFrontmatterValue(source, ["draft"])),
    featured: normalizeFrontmatterBoolean(findFrontmatterValue(source, ["featured"])),
  };
}

function parseMarkdownFile(markdown: string) {
  const normalizedMarkdown = normalizeMarkdownLineEndings(markdown);
  if (!normalizedMarkdown.startsWith("---\n")) {
    return {
      frontmatter: {} as FrontmatterData,
      body: normalizedMarkdown,
    };
  }

  const frontmatterEndIndex = normalizedMarkdown.indexOf("\n---\n", 4);
  if (frontmatterEndIndex === -1) {
    return {
      frontmatter: {} as FrontmatterData,
      body: normalizedMarkdown,
    };
  }

  const frontmatterBlock = normalizedMarkdown.slice(4, frontmatterEndIndex);
  const body = normalizedMarkdown.slice(frontmatterEndIndex + 5);
  let frontmatter: FrontmatterData = {};

  if (frontmatterBlock.trim().length > 0) {
    try {
      const parsedFrontmatter = parseYAML(frontmatterBlock);
      if (isFrontmatterSource(parsedFrontmatter)) {
        frontmatter = normalizeFrontmatterData(parsedFrontmatter);
      }
    } catch {
      throw new Error("Markdown frontmatter 解析失败，请检查 YAML 格式。");
    }
  }

  return {
    frontmatter,
    body,
  };
}

function markdownPlainText(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[>*_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeMarkdown(markdown: string) {
  const plainText = markdownPlainText(markdown);
  if (plainText.length <= 80) {
    return plainText;
  }

  return `${plainText.slice(0, 80).trim()}...`;
}

function inferMarkdownTitle(markdown: string) {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch?.[1]?.trim() ?? "";
}

function stripMarkdownExtension(fileName: string) {
  return fileName.replace(/\.(md|markdown)$/i, "");
}

function stripHTMLDocumentExtension(fileName: string) {
  return fileName.replace(/\.(html?|xhtml)$/i, "");
}

function escapeMarkdownAltText(value: string) {
  return value.replace(/[\[\]]/g, "\\$&");
}

function escapeHTMLAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inferImageAltText(value: string) {
  const inferredText = value
    .split("/")
    .pop()
    ?.split("?")[0]
    ?.replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

  return inferredText && inferredText.length > 0 ? inferredText : "image";
}

function buildImageMarkdown(source: string, altText: string) {
  return `![${escapeMarkdownAltText(altText)}](${source})`;
}

function buildImageHTML(source: string, altText: string) {
  return `<figure>\n  <img src="${escapeHTMLAttribute(source)}" alt="${escapeHTMLAttribute(altText)}" />\n</figure>`;
}

function buildImageSnippet(source: string, altText: string, bodyFormat: BodyFormat) {
  return bodyFormat === "html" ? buildImageHTML(source, altText) : buildImageMarkdown(source, altText);
}

type MarkdownMathWrapMode = "inline" | "block";

interface MarkdownMathWrapResult {
  text: string;
  selectionStartOffset: number;
  selectionEndOffset: number;
}

function paddingBeforeStandaloneMarkdownBlock(value: string) {
  if (value.length === 0 || value.endsWith("\n\n")) {
    return "";
  }

  return value.endsWith("\n") ? "\n" : "\n\n";
}

function paddingAfterStandaloneMarkdownBlock(value: string) {
  if (value.length === 0 || value.startsWith("\n\n")) {
    return "";
  }

  return value.startsWith("\n") ? "\n" : "\n\n";
}

function wrapMarkdownMathSelection(selection: string, mode: MarkdownMathWrapMode): MarkdownMathWrapResult {
  if (mode === "inline") {
    return {
      text: `$${selection}$`,
      selectionStartOffset: 1,
      selectionEndOffset: selection.length + 1,
    };
  }

  const openingDelimiter = "$$\n";
  const closingDelimiter = "\n$$";

  return {
    text: `${openingDelimiter}${selection}${closingDelimiter}`,
    selectionStartOffset: openingDelimiter.length,
    selectionEndOffset: openingDelimiter.length + selection.length,
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function imageExtensionForMimeType(value: string) {
  switch (value) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "img";
  }
}

function renameImageFile(fileName: string, mimeType: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.${imageExtensionForMimeType(mimeType)}`;
}

function loadImageElement(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取图片内容，无法自动压缩。"));
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("图片压缩失败，请稍后重试。"));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });
}

async function compressImageForUpload(file: File, maxBytes: number) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error("无法读取图片尺寸，无法自动压缩。");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器不支持图片自动压缩，请先手动压缩后再上传。");
    }

    const preferredMimeType = file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg";
    let bestBlob: Blob | null = null;

    for (const scale of imageCompressionScaleSteps) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      for (const quality of imageCompressionQualitySteps) {
        const blob = await canvasToBlob(canvas, preferredMimeType, quality);
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
        }

        if (blob.size <= maxBytes) {
          const outputType = blob.type || preferredMimeType;
          return new File([blob], renameImageFile(file.name, outputType), {
            type: outputType,
            lastModified: file.lastModified,
          });
        }
      }
    }

    if (bestBlob && bestBlob.size < file.size) {
      throw new Error(
        `图片自动压缩后仍有 ${formatFileSize(bestBlob.size)}，超过 8MB 上传上限。请先裁剪图片，或手动压缩后再试。`,
      );
    }

    throw new Error("图片压缩失败，请先手动压缩后再上传。");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareImageForUpload(file: File, maxBytes: number): Promise<PreparedUploadImage> {
  if (file.size <= maxBytes) {
    return {
      file,
      originalBytes: file.size,
      compressed: false,
    };
  }

  if (file.type === "image/gif") {
    throw new Error("GIF 图片超过 8MB，暂不自动压缩。请先手动压缩，或改用静态图。");
  }

  if (!autoCompressibleImageTypes.has(file.type)) {
    throw new Error("当前图片格式无法自动压缩，请先转换为 JPG、PNG 或 WebP。");
  }

  const compressedFile = await compressImageForUpload(file, maxBytes);
  return {
    file: compressedFile,
    originalBytes: file.size,
    compressed: true,
  };
}

function formSignature(form: WriteFormState) {
  return JSON.stringify({
    ...form,
    title: form.title.trim(),
    slug: form.slug.trim(),
    summary: form.summary.trim(),
    category: form.category.trim(),
    tags: normalizeTags(form.tags),
    author: form.author.trim(),
    publishedAt: form.publishedAt.trim(),
    accent: form.accent.trim(),
    bodyFormat: normalizeBodyFormat(form.bodyFormat),
    body: normalizeMarkdownLineEndings(form.body),
  });
}

function autosaveStorageKey(editorKey: string) {
  return `${autosaveStorageKeyPrefix}:${editorKey}`;
}

function readAutosaveSnapshot(storageKey: string): AutosaveSnapshot | null {
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const snapshot = JSON.parse(rawValue) as AutosaveSnapshot;
    return {
      ...snapshot,
      form: normalizeWriteFormState(snapshot.form),
    };
  } catch {
    return null;
  }
}

function writeAutosaveSnapshot(storageKey: string, snapshot: AutosaveSnapshot) {
  window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

function clearAutosaveSnapshot(storageKey: string) {
  window.localStorage.removeItem(storageKey);
}

function formatAutosaveTime(dateString: string) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function normalizeTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
}

function buildMetadataChanges(originalPost: Post, form: WriteFormState): MetadataChange[] {
  const comparisons: Array<[string, string, string]> = [
    ["标题", originalPost.title, form.title.trim()],
    ["Slug", originalPost.slug, form.slug.trim()],
    ["摘要", originalPost.summary, form.summary.trim()],
    ["分类", originalPost.category, form.category.trim()],
    ["标签", originalPost.tags.join(", "), normalizeTags(form.tags)],
    ["作者", originalPost.author, form.author.trim()],
    ["发布日期", originalPost.publishedAt, form.publishedAt.trim()],
    ["草稿", originalPost.draft ? "是" : "否", form.draft ? "是" : "否"],
    ["首页精选", originalPost.featured ? "是" : "否", form.featured ? "是" : "否"],
    ["正文格式", originalPost.bodyFormat === "html" ? "HTML" : "Markdown", form.bodyFormat === "html" ? "HTML" : "Markdown"],
    ["Accent", originalPost.accent, form.accent.trim()],
  ];

  return comparisons
    .filter(([, before, after]) => before !== after)
    .map(([label, before, after]) => ({ label, before, after }));
}

function buildBodyDiff(before: string, after: string): DiffLine[] {
  const beforeLines = normalizeMarkdownLineEndings(before).split("\n");
  const afterLines = normalizeMarkdownLineEndings(after).split("\n");
  const lengths = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0));

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex][afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? lengths[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1]) {
      diff.push({ kind: "remove", text: beforeLines[beforeIndex] });
      beforeIndex += 1;
      continue;
    }

    diff.push({ kind: "add", text: afterLines[afterIndex] });
    afterIndex += 1;
  }

  while (beforeIndex < beforeLines.length) {
    diff.push({ kind: "remove", text: beforeLines[beforeIndex] });
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    diff.push({ kind: "add", text: afterLines[afterIndex] });
    afterIndex += 1;
  }

  return diff;
}

function formatPublishDate(dateString: string) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function WritePage() {
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const newPostTemplateRef = useRef<WriteFormState>(createEmptyFormState());
  const skipNextAutosaveCleanupRef = useRef(false);
  const listRequestRef = useRef(0);
  const allPostsRequestRef = useRef(0);
  const [form, setForm] = useState<WriteFormState>(newPostTemplateRef.current);
  const [allPosts, setAllPosts] = useState<PostSummary[]>([]);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchAction, setBatchAction] = useState<BatchPostsAction | null>(null);
  const [actingSlug, setActingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState("");
  const [accessVerified, setAccessVerified] = useState(false);
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<"all" | "published" | "draft">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [originalPost, setOriginalPost] = useState<Post | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [autosaveSavedAt, setAutosaveSavedAt] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAltText, setImageAltText] = useState("");
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [bodyToolStatus, setBodyToolStatus] = useState<string | null>(null);

  const isEditing = selectedSlug !== null;
  const featuredPosts = allPosts.filter((post) => post.featured).slice(0, 3);
  const featuredLimitReached = featuredPosts.length >= 3;
  const draftCount = allPosts.filter((post) => post.draft).length;
  const publishedCount = allPosts.length - draftCount;
  const editorKey = selectedSlug ?? "new";
  const currentAutosaveKey = autosaveStorageKey(editorKey);
  const baselineForm = originalPost ? formStateFromPost(originalPost) : newPostTemplateRef.current;
  const hasUnsavedChanges = formSignature(form) !== formSignature(baselineForm);
  const hasUnpublishedChanges = form.draft && hasUnsavedChanges;
  const canFeatureCurrentForm = !form.draft && (form.featured || originalPost?.featured === true || !featuredLimitReached);
  const featuredSlotsRemaining = Math.max(0, 3 - featuredPosts.length);
  const visiblePosts = posts.filter((post) => {
    if (listFilter === "draft" && !post.draft) {
      return false;
    }

    if (listFilter === "published" && post.draft) {
      return false;
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return true;
    }

    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return true;
    }

    const haystack = [
      post.title,
      post.summary,
      post.slug,
      post.author,
      post.category,
      post.tags.join(" "),
      post.searchSnippet?.text ?? "",
    ].join(" ").toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
  const allVisibleSelected = visiblePosts.length > 0 && visiblePosts.every((post) => selectedSlugs.includes(post.slug));
  const metadataChanges = originalPost ? buildMetadataChanges(originalPost, form) : [];
  const bodyDiff = originalPost ? buildBodyDiff(originalPost.body, form.body).slice(0, 120) : [];
  const hasPendingDiff = metadataChanges.length > 0 || bodyDiff.length > 0;

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem(writeTokenStorageKey);
    if (!storedToken) {
      return;
    }

    setWriteToken(storedToken);
    void handleVerifyAccess(storedToken, true);
  }, []);

  // Fetch posts when access is verified and when search/filter changes.
  useEffect(() => {
    if (!accessVerified) {
      setAllPosts([]);
      setPosts([]);
      setSelectedSlug(null);
      return;
    }

    void loadAllPosts();
  }, [accessVerified, writeToken]);

  useEffect(() => {
    if (!accessVerified) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadPosts();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [accessVerified, searchQuery, listFilter, writeToken]);

  useEffect(() => {
    if (!accessVerified) {
      setAutosaveStatus("idle");
      setAutosaveSavedAt(null);
      return;
    }

    setAutosaveStatus("idle");
    setAutosaveSavedAt(null);

    const snapshot = readAutosaveSnapshot(currentAutosaveKey);
    if (!snapshot) {
      return;
    }

    if (formSignature(snapshot.form) === formSignature(baselineForm)) {
      clearAutosaveSnapshot(currentAutosaveKey);
      return;
    }

    skipNextAutosaveCleanupRef.current = true;
    setForm(normalizeWriteFormState(snapshot.form));
    setImportedFileName(snapshot.importedFileName);
    setAutosaveStatus("saved");
    setAutosaveSavedAt(snapshot.savedAt);
    setSuccessMessage("已恢复本地自动保存内容。未保存变更仍会在离开页面前提醒。");
  }, [accessVerified, currentAutosaveKey, selectedSlug, originalPost]);

  useEffect(() => {
    if (!accessVerified) {
      return;
    }

    if (!hasUnsavedChanges) {
      if (skipNextAutosaveCleanupRef.current) {
        skipNextAutosaveCleanupRef.current = false;
        return;
      }

      clearAutosaveSnapshot(currentAutosaveKey);
      setAutosaveStatus("idle");
      setAutosaveSavedAt(null);
      return;
    }

    setAutosaveStatus("saving");
    const snapshot: AutosaveSnapshot = {
      form,
      importedFileName,
      savedAt: new Date().toISOString(),
    };

    const timer = window.setTimeout(() => {
      writeAutosaveSnapshot(currentAutosaveKey, snapshot);
      setAutosaveStatus("saved");
      setAutosaveSavedAt(snapshot.savedAt);
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [accessVerified, currentAutosaveKey, form, importedFileName, hasUnsavedChanges]);

  useEffect(() => {
    if (!accessVerified || !hasUnsavedChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [accessVerified, hasUnsavedChanges]);

  async function loadAllPosts() {
    const requestId = allPostsRequestRef.current + 1;
    allPostsRequestRef.current = requestId;

    try {
      const items = await fetchAdminPosts(writeToken.trim());
      if (requestId !== allPostsRequestRef.current) {
        return;
      }

      setAllPosts(items);
    } catch (requestError) {
      if (requestId !== allPostsRequestRef.current) {
        return;
      }

      setError(requestError instanceof Error ? requestError.message : "文章统计加载失败。");
    }
  }

  async function loadPosts(queryOverride = searchQuery.trim(), filterOverride = listFilter) {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setPostsLoading(true);

    try {
      const items = await fetchAdminPosts(writeToken.trim(), queryOverride, filterOverride);
      if (requestId !== listRequestRef.current) {
        return;
      }

      setPosts(items);
      setSelectedSlugs((current) => current.filter((slug) => items.some((post) => post.slug === slug)));
    } catch (requestError) {
      if (requestId !== listRequestRef.current) {
        return;
      }

      setError(requestError instanceof Error ? requestError.message : "文章列表加载失败。");
    } finally {
      if (requestId === listRequestRef.current) {
        setPostsLoading(false);
      }
    }
  }

  async function refreshPostLists() {
    await Promise.all([loadAllPosts(), loadPosts()]);
  }

  function renderHighlighted(text: string | undefined | null) {
    const str = String(text ?? "");
    const q = searchQuery.trim();
    if (q.length === 0) {
      return str;
    }

    const tokens = q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    if (tokens.length === 0) {
      return str;
    }

    const re = new RegExp(`(${tokens.join("|")})`, "ig");
    const parts = str.split(re);

    return parts.map((part, i) => (part.match(re) ? (
      <mark key={i} className="rounded px-1 bg-amber-100 text-amber-800">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    )));
  }

  function formatSearchScore(score: number | undefined) {
    if (typeof score !== "number" || Number.isNaN(score)) {
      return null;
    }

    return score >= 10 ? score.toFixed(1) : score.toFixed(2);
  }

  function updateField<Key extends keyof WriteFormState>(field: Key, value: WriteFormState[Key]) {
    if (field === "body" || field === "bodyFormat") {
      setBodyToolStatus(null);
    }

    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleNormalizeBodyLatex() {
    const normalizedBody = normalizeLatexInBody(form.body, form.bodyFormat);

    if (normalizedBody.body !== form.body) {
      updateField("body", normalizedBody.body);
    }

    setError(null);

    if (normalizedBody.matchedExpressions === 0) {
      setBodyToolStatus(
        form.bodyFormat === "html"
          ? "未找到可标准化的 data-math TeX 节点。"
          : "未找到带显式定界符的 LaTeX 公式。",
      );
    } else if (normalizedBody.changedExpressions === 0) {
      setBodyToolStatus(`已检查 ${normalizedBody.matchedExpressions} 段公式，未发现需要标准化的写法。`);
    } else {
      setBodyToolStatus(`已标准化 ${normalizedBody.changedExpressions}/${normalizedBody.matchedExpressions} 段公式。`);
    }

    window.requestAnimationFrame(() => {
      bodyTextareaRef.current?.focus();
    });
  }

  function handleWrapBodySelection(mode: MarkdownMathWrapMode) {
    if (form.bodyFormat !== "markdown") {
      setBodyToolStatus("当前正文格式为 HTML；$...$ / $$...$$ 包裹工具仅适用于 Markdown。");
      return;
    }

    const editor = bodyTextareaRef.current;
    const selectionStart = editor?.selectionStart ?? form.body.length;
    const selectionEnd = editor?.selectionEnd ?? form.body.length;
    const before = form.body.slice(0, selectionStart);
    const selectedText = form.body.slice(selectionStart, selectionEnd);
    const after = form.body.slice(selectionEnd);
    const prefix = mode === "block" ? paddingBeforeStandaloneMarkdownBlock(before) : "";
    const suffix = mode === "block" ? paddingAfterStandaloneMarkdownBlock(after) : "";
    const wrappedSelection = wrapMarkdownMathSelection(selectedText, mode);
    const nextBody = `${before}${prefix}${wrappedSelection.text}${suffix}${after}`;
    const nextSelectionStart = before.length + prefix.length + wrappedSelection.selectionStartOffset;
    const nextSelectionEnd = before.length + prefix.length + wrappedSelection.selectionEndOffset;

    updateField("body", nextBody);
    setError(null);
    setBodyToolStatus(
      mode === "block"
        ? selectedText.length === 0
          ? "已插入 $$...$$ 块级公式模板。"
          : "已将当前选区包成 $$...$$ 块级公式。"
        : selectedText.length === 0
          ? "已插入 $...$ 行内公式定界符。"
          : "已将当前选区包成 $...$ 行内公式。",
    );

    window.requestAnimationFrame(() => {
      const textarea = bodyTextareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  }

  function insertBodyBlock(snippet: string) {
    const editor = bodyTextareaRef.current;
    const selectionStart = editor?.selectionStart ?? form.body.length;
    const selectionEnd = editor?.selectionEnd ?? form.body.length;
    const before = form.body.slice(0, selectionStart);
    const after = form.body.slice(selectionEnd);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n\n" : "";
    const nextBody = `${before}${prefix}${snippet}${suffix}${after}`;
    const nextCursorPosition = `${before}${prefix}${snippet}`.length;

    updateField("body", nextBody);
    window.requestAnimationFrame(() => {
      const textarea = bodyTextareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function insertImageMarkdown(source: string, suggestedAltText?: string) {
    const altText = imageAltText.trim() || suggestedAltText || inferImageAltText(source);
    insertBodyBlock(buildImageSnippet(source, altText, form.bodyFormat));
    setError(null);
    return altText;
  }

  function handleInsertImageByUrl() {
    const normalizedImageUrl = imageUrl.trim();
    if (normalizedImageUrl.length === 0) {
      return;
    }

    const altText = insertImageMarkdown(normalizedImageUrl);
    setImageStatus(`已插入图片链接：${altText}`);
    setImageUrl("");
  }

  async function handleImageFileInsert(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setImageStatus(null);
	  setError("只能插入图片文件。请重新选择 PNG、JPG、SVG、WebP 等图片。");
      return;
    }

	const shouldAttemptCompression = file.size > maxUploadImageSizeBytes && autoCompressibleImageTypes.has(file.type);

    try {
      setUploadingImage(true);
      setError(null);
      setImageStatus(
	    shouldAttemptCompression ? `图片超过 8MB，正在自动压缩：${formatFileSize(file.size)}` : null,
      );

      const preparedImage = await prepareImageForUpload(file, maxUploadImageSizeBytes);
      if (preparedImage.compressed) {
        setImageStatus(
          `已自动压缩图片，准备上传：${formatFileSize(preparedImage.originalBytes)} -> ${formatFileSize(preparedImage.file.size)}`,
        );
      }

      const response = await uploadImage(preparedImage.file, writeToken.trim());
      const altText = insertImageMarkdown(response.url, inferImageAltText(file.name));
      const uploadDetail = preparedImage.compressed
        ? `（${formatFileSize(preparedImage.originalBytes)} -> ${formatFileSize(preparedImage.file.size)}，alt: ${altText}）`
        : `（alt: ${altText}）`;

      setImageStatus(
        preparedImage.compressed
          ? response.cached
            ? `已自动压缩并复用站点图片：${file.name}${uploadDetail}`
            : `已自动压缩并上传图片：${file.name}${uploadDetail}`
          : response.cached
            ? `已复用站点图片：${file.name}${uploadDetail}`
            : `已上传并插入图片：${file.name}${uploadDetail}`,
      );
    } catch (requestError) {
      setImageStatus(null);
      setError(requestError instanceof Error ? requestError.message : "本地图片读取失败。");
    } finally {
      setUploadingImage(false);
    }
  }

  function confirmDiscardUnsavedChanges(actionLabel: string) {
    if (!hasUnsavedChanges) {
      return true;
    }

    const reminder = hasUnpublishedChanges
      ? "当前草稿有未保存且未发布的变更。"
      : "当前编辑器有未保存变更。";

    return window.confirm(`${reminder} 确认继续${actionLabel}吗？`);
  }

  function resetEditor(options?: { preserveCurrentAutosave?: boolean }) {
    if (!options?.preserveCurrentAutosave) {
      clearAutosaveSnapshot(currentAutosaveKey);
    }

    newPostTemplateRef.current = createEmptyFormState();
    setSelectedSlug(null);
    setOriginalPost(null);
    setForm(newPostTemplateRef.current);
    setImportedFileName(null);
    setError(null);
    setSuccessMessage(null);
    setAutosaveStatus("idle");
    setAutosaveSavedAt(null);
    setImageUrl("");
    setImageAltText("");
    setImageStatus(null);
    setUploadingImage(false);
    setBodyToolStatus(null);
  }

  function selectEditorPost(post: Post) {
    setSelectedSlug(post.slug);
    setOriginalPost(post);
    setForm(formStateFromPost(post));
    setImportedFileName(null);
    setImageStatus(null);
    setUploadingImage(false);
    setBodyToolStatus(null);
  }

  function toggleSelectedSlug(slug: string) {
    setSelectedSlugs((current) =>
      current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug],
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedSlugs((current) => current.filter((slug) => !visiblePosts.some((post) => post.slug === slug)));
      return;
    }

    setSelectedSlugs((current) => {
      const next = new Set(current);
      visiblePosts.forEach((post) => next.add(post.slug));
      return Array.from(next);
    });
  }

  function updateDraftState(draft: boolean) {
    setForm((current) => ({
      ...current,
      draft,
      featured: draft ? false : current.featured,
    }));
  }

  async function handleVerifyAccess(tokenOverride?: string, silent = false) {
    const normalizedToken = (tokenOverride ?? writeToken).trim();
    if (normalizedToken.length === 0) {
      setAccessVerified(false);
      if (!silent) {
        setAccessMessage("先输入写作令牌，再验证写作入口。");
      }
      return false;
    }

    setVerifyingAccess(true);
    if (!silent) {
      setAccessMessage(null);
    }
    setError(null);

    try {
      const response = await verifyWriteAccess(normalizedToken);
      window.sessionStorage.setItem(writeTokenStorageKey, normalizedToken);
      setWriteToken(normalizedToken);
      setAccessVerified(true);
      setAccessMessage(response.message);
      return true;
    } catch (requestError) {
      window.sessionStorage.removeItem(writeTokenStorageKey);
      setAccessVerified(false);
      setAccessMessage(requestError instanceof Error ? requestError.message : "写作令牌验证失败。");
      return false;
    } finally {
      setVerifyingAccess(false);
    }
  }

  function clearWriteAccess() {
    if (!confirmDiscardUnsavedChanges("退出管理端")) {
      return;
    }

    window.sessionStorage.removeItem(writeTokenStorageKey);
    setWriteToken("");
    setAccessVerified(false);
    setAccessMessage("已清除当前浏览器会话里的写作令牌。");
    setPosts([]);
    resetEditor({ preserveCurrentAutosave: true });
  }

  async function handleMarkdownImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const { frontmatter, body } = parseMarkdownFile(content);
      const resolvedBody = body.trim();
      const inferredTitle =
        typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
          ? frontmatter.title.trim()
          : inferMarkdownTitle(resolvedBody);

      setForm((current) => ({
        ...current,
        title: inferredTitle || current.title,
        slug:
          typeof frontmatter.slug === "string" && frontmatter.slug.trim().length > 0
            ? frontmatter.slug.trim()
            : current.slug || stripMarkdownExtension(file.name),
        summary:
          typeof frontmatter.summary === "string" && frontmatter.summary.trim().length > 0
            ? frontmatter.summary.trim()
            : summarizeMarkdown(resolvedBody),
        category:
          typeof frontmatter.category === "string" && frontmatter.category.trim().length > 0
            ? frontmatter.category.trim()
            : current.category,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.join(", ") : current.tags,
        author:
          typeof frontmatter.author === "string" && frontmatter.author.trim().length > 0
            ? frontmatter.author.trim()
            : current.author,
        publishedAt:
          typeof frontmatter.publishedAt === "string" && frontmatter.publishedAt.trim().length > 0
            ? frontmatter.publishedAt.trim()
            : current.publishedAt,
        accent:
          typeof frontmatter.accent === "string" && frontmatter.accent.trim().length > 0
            ? frontmatter.accent.trim()
            : current.accent,
        draft: typeof frontmatter.draft === "boolean" ? frontmatter.draft : current.draft,
        featured: typeof frontmatter.featured === "boolean" ? frontmatter.featured : current.featured,
        bodyFormat: "markdown",
        body: resolvedBody || current.body,
      }));
      setImportedFileName(file.name);
      setError(null);
      setSuccessMessage(null);
      setBodyToolStatus(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "本地 Markdown 导入失败。");
    }
  }

  async function handleHTMLImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setError(null);
      setSuccessMessage(null);
      const imported = await importHTMLDocument(file, writeToken.trim());
      applyImportedHTML(imported, file.name, stripHTMLDocumentExtension(file.name));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HTML 导入失败。");
    }
  }

  function applyImportedHTML(imported: HTMLImportResponse, sourceLabel: string, fallbackSlug?: string) {
    setForm((current) => ({
      ...current,
      title: imported.title || current.title,
      slug: imported.slug || current.slug || fallbackSlug || "",
      summary: imported.summary || current.summary,
      tags: imported.tags.length > 0 ? imported.tags.join(", ") : current.tags,
      author: imported.author || current.author,
      publishedAt: imported.publishedAt || current.publishedAt,
      bodyFormat: normalizeBodyFormat(imported.bodyFormat),
      body: imported.body || current.body,
    }));
    setImportedFileName(sourceLabel);
    setError(null);
    setSuccessMessage(null);
    setBodyToolStatus(null);
  }

  async function handleEditPost(slug: string) {
    if (slug !== selectedSlug && !confirmDiscardUnsavedChanges("切换到另一篇文章")) {
      return;
    }

    setEditorLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const post = await fetchAdminPost(slug, writeToken.trim());
      selectEditorPost(post);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "文章详情加载失败。");
    } finally {
      setEditorLoading(false);
    }
  }

  async function handleDeletePost(post: PostSummary) {
    if (!window.confirm(`确认删除《${post.title}》吗？此操作无法撤销。`)) {
      return;
    }

    setActingSlug(post.slug);
    setError(null);
    setSuccessMessage(null);

    try {
      await deletePost(post.slug, writeToken.trim());
      if (selectedSlug === post.slug) {
        resetEditor();
      }

      await refreshPostLists();
      setSuccessMessage(`已删除《${post.title}》。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除文章失败。");
    } finally {
      setActingSlug(null);
    }
  }

  async function handleToggleFeatured(post: PostSummary) {
    setActingSlug(post.slug);
    setError(null);
    setSuccessMessage(null);

    try {
      const updatedPost = await setPostFeatured(post.slug, !post.featured, writeToken.trim());
      await refreshPostLists();

      if (selectedSlug === updatedPost.slug) {
        setForm((current) => ({
          ...current,
          draft: updatedPost.draft,
          featured: updatedPost.featured,
        }));
        setOriginalPost(updatedPost);
      }

      setSuccessMessage(updatedPost.featured ? `已将《${updatedPost.title}》设为首页精选。` : `已取消《${updatedPost.title}》的首页精选。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新置顶状态失败。");
    } finally {
      setActingSlug(null);
    }
  }

  async function handleBatchAction(action: BatchPostsAction) {
    if (selectedSlugs.length === 0) {
      return;
    }

    if (selectedSlug && selectedSlugs.includes(selectedSlug) && !confirmDiscardUnsavedChanges(`执行批量${batchActionLabels[action]}`)) {
      return;
    }

    if (action === "delete" && !window.confirm(`确认批量删除 ${selectedSlugs.length} 篇文章吗？此操作无法撤销。`)) {
      return;
    }

    setBatchAction(action);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await batchPosts(action, selectedSlugs, writeToken.trim());

      if (selectedSlug && selectedSlugs.includes(selectedSlug)) {
        if (action === "delete") {
          resetEditor();
        } else {
          const nextDraft = action === "draft";
          setForm((current) => ({
            ...current,
            draft: nextDraft,
            featured: nextDraft ? false : current.featured,
          }));
          setOriginalPost((current) =>
            current
              ? {
                  ...current,
                  draft: nextDraft,
                  featured: nextDraft ? false : current.featured,
                }
              : current,
          );
        }
      }

      await refreshPostLists();
      setSelectedSlugs([]);
      setSuccessMessage(`已对 ${response.affected} 篇文章执行${batchActionLabels[action]}操作。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "批量操作失败。");
    } finally {
      setBatchAction(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const hasAccess = accessVerified || (await handleVerifyAccess());
      if (!hasAccess) {
        setError("写作令牌无效，无法发布文章。");
        return;
      }

      const payload = {
        title: form.title,
        slug: form.slug || undefined,
        summary: form.summary || undefined,
        category: form.category || undefined,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        author: form.author || undefined,
        publishedAt: form.publishedAt || undefined,
        draft: form.draft,
        featured: form.featured,
        accent: form.accent || undefined,
        bodyFormat: form.bodyFormat,
        body: form.body,
      };

      const post = isEditing && selectedSlug
        ? await updatePost(selectedSlug, payload, writeToken.trim())
        : await createPost(payload, writeToken.trim());

      clearAutosaveSnapshot(currentAutosaveKey);
      clearAutosaveSnapshot(autosaveStorageKey(post.slug));

      selectEditorPost(post);
      await refreshPostLists();
      setSelectedSlugs([]);
      setAutosaveStatus("idle");
      setAutosaveSavedAt(null);
      setSuccessMessage(isEditing ? `已更新《${post.title}》。` : `已创建《${post.title}》。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : isEditing ? "更新失败，请稍后再试。" : "发布失败，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (!accessVerified) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="overflow-hidden border border-black/10 bg-[var(--panel-strong)] shadow-[0_30px_90px_rgba(77,53,35,0.12)]">
          <div className="h-3 w-full bg-[linear-gradient(90deg,#0f766e_0%,#f59e0b_100%)]" />
          <CardHeader className="flex flex-col items-start gap-4 px-6 pb-0 pt-6 sm:px-8 sm:pt-8">
            <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">Admin Console</p>
            <div className="max-w-2xl space-y-4">
              <h1 className="display-type text-4xl leading-none text-[var(--ink)] sm:text-5xl">
                这是管理端入口，不对访客显示。
              </h1>
              <p className="text-base leading-8 text-[var(--muted)] sm:text-lg">
                公开页面只保留文章、归档和详情阅读。输入服务端的 BLOG_WRITE_TOKEN 验证当前会话后，才会加载文章列表、编辑、删除、置顶和导入 Markdown/HTML 的后台操作面板。
              </p>
            </div>
          </CardHeader>

          <CardBody className="space-y-5 px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
            <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                <Input
                  type="password"
                  label="管理令牌"
                  labelPlacement="outside"
                  placeholder="输入 BLOG_WRITE_TOKEN"
                  radius="lg"
                  value={writeToken}
                  onValueChange={setWriteToken}
                />
                <Button
                  type="button"
                  radius="full"
                  color="primary"
                  isDisabled={verifyingAccess || writeToken.trim().length === 0}
                  onPress={() => {
                    void handleVerifyAccess();
                  }}
                >
                  {verifyingAccess ? "验证中..." : "进入管理端"}
                </Button>
                <Button
                  type="button"
                  radius="full"
                  variant="light"
                  isDisabled={writeToken.trim().length === 0 && !accessMessage}
                  onPress={clearWriteAccess}
                >
                  清除
                </Button>
              </div>

              <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
                验证通过后，令牌只保存在当前浏览器会话里；访客导航和公开页面不会再展示管理入口。
              </p>

              {accessMessage ? (
                <div className="mt-3 rounded-[1rem] border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                  {accessMessage}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                to="/"
                className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                返回首页
              </Link>
              <Link
                to="/archive"
                className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                查看归档
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="border border-black/10 bg-[var(--panel-strong)] shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
          <CardBody className="gap-2 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Admin Status</p>
            <p className="text-3xl font-semibold text-[var(--ink)]">已解锁</p>
            <p className="text-sm leading-7 text-[var(--muted)]">当前浏览器会话已验证，可执行草稿、批量操作、编辑、删除和置顶操作。</p>
          </CardBody>
        </Card>

        <Card className="border border-black/10 bg-[var(--panel-strong)] shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
          <CardBody className="gap-2 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Published</p>
            <p className="text-3xl font-semibold text-[var(--ink)]">{publishedCount}</p>
            <p className="text-sm leading-7 text-[var(--muted)]">已发布内容继续走公开列表与详情页，保持访客视角稳定。</p>
          </CardBody>
        </Card>

        <Card className="border border-black/10 bg-[var(--panel-strong)] shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
          <CardBody className="gap-2 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Drafts</p>
            <p className="text-3xl font-semibold text-[var(--ink)]">{draftCount}</p>
            <p className="text-sm leading-7 text-[var(--muted)]">草稿只在管理端可见，适合先整理内容再决定是否发布。</p>
          </CardBody>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_380px]">
        <Card className="overflow-hidden border border-black/10 bg-[var(--panel-strong)] shadow-[0_30px_90px_rgba(77,53,35,0.12)]">
          <div className="h-3 w-full bg-[linear-gradient(90deg,#0f766e_0%,#f59e0b_100%)]" />
          <CardHeader className="flex flex-col items-start gap-4 px-6 pb-0 pt-6 sm:px-8 sm:pt-8">
            <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">Admin Workspace</p>
            <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl space-y-4">
                <h1 className="display-type text-4xl leading-none text-[var(--ink)] sm:text-5xl">
                  {isEditing ? "编辑现有文章" : "新建后台内容"}
                </h1>
                <p className="max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                  后台现在不只是发布表单。你可以在右侧按发布状态筛选、批量操作多篇文章，选中单篇后继续编辑，还能在保存前看元数据和正文 diff；未保存内容会自动保存到本地。
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  radius="full"
                  variant={isEditing ? "bordered" : "solid"}
                  onPress={() => {
                    if (confirmDiscardUnsavedChanges("开始新建文章")) {
                      resetEditor();
                    }
                  }}
                >
                  新建文章
                </Button>
                {selectedSlug && !form.draft ? (
                  <Link
                    to={`/posts/${selectedSlug}`}
                    className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
                  >
                    打开正文页
                  </Link>
                ) : null}
                {selectedSlug && !form.draft ? <Chip variant="bordered">PDF 下载在正文页</Chip> : null}
                {selectedSlug && form.draft ? <Chip color="warning" variant="flat">草稿仅管理端可见</Chip> : null}
                <Button type="button" radius="full" variant="light" onPress={clearWriteAccess}>
                  退出管理端
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardBody className="space-y-5 px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
            <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
              <div className="flex flex-wrap items-center gap-2">
                <Chip color="secondary" variant="flat">当前会话已验证</Chip>
                <Chip color="warning" variant="flat">管理令牌已载入</Chip>
                <Chip variant="bordered">首页精选 {featuredPosts.length}/3</Chip>
                {featuredPosts.map((post) => <Chip key={post.slug} variant="bordered">{post.title}</Chip>)}
                {isEditing ? <Chip variant="bordered">编辑模式</Chip> : <Chip variant="bordered">新建模式</Chip>}
                {hasUnsavedChanges ? <Chip color="warning" variant="flat">未保存变更</Chip> : null}
                {hasUnpublishedChanges ? <Chip variant="bordered">未发布变更</Chip> : null}
              </div>
              <p className="mt-3">
                {hasUnsavedChanges
                  ? hasUnpublishedChanges
                    ? "当前草稿有未保存且未发布的变更；继续编辑时会自动保存到本地，离开页面前也会提醒。"
                    : "当前文章有未保存变更；继续编辑时会自动保存到本地，离开页面前也会提醒。"
                  : accessMessage ?? "当前会话会自动附带 Bearer token，无需在每次提交前重复验证。"}
              </p>
              <p className="text-xs leading-6 text-[var(--muted)]">
                {autosaveStatus === "saving"
                  ? "自动保存中..."
                  : autosaveSavedAt
                    ? `本地自动保存时间：${formatAutosaveTime(autosaveSavedAt)}`
                    : "当前内容与最近一次保存保持一致。"}
              </p>
            </div>

            {editorLoading ? (
              <div className="flex min-h-40 items-center justify-center rounded-[1.5rem] border border-dashed border-black/10 bg-white/40">
                <Spinner color="secondary" label="正在加载文章内容" labelColor="secondary" />
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[1.25rem] border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                {error}
              </div>
            ) : null}

            {successMessage ? (
              <div className="rounded-[1.25rem] border border-success/30 bg-success-50 px-4 py-3 text-sm text-success-700">
                {successMessage}
              </div>
            ) : null}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="标题"
                  labelPlacement="outside"
                  placeholder="例如：一次 SSA pass 的性能回归排查"
                  radius="lg"
                  value={form.title}
                  onValueChange={(value) => updateField("title", value)}
                />
                <Input
                  label="Slug"
                  labelPlacement="outside"
                  placeholder="可选，留空会自动生成"
                  radius="lg"
                  value={form.slug}
                  onValueChange={(value) => updateField("slug", value)}
                />
              </div>

              <Input
                label="摘要"
                labelPlacement="outside"
                placeholder="可选，留空会从正文自动提取一段概述"
                radius="lg"
                value={form.summary}
                onValueChange={(value) => updateField("summary", value)}
              />

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input
                  label="分类"
                  labelPlacement="outside"
                  radius="lg"
                  value={form.category}
                  onValueChange={(value) => updateField("category", value)}
                />
                <Input
                  label="标签"
                  labelPlacement="outside"
                  placeholder="例如 perf, llvm, cuda, make, kubernetes"
                  radius="lg"
                  value={form.tags}
                  onValueChange={(value) => updateField("tags", value)}
                />
                <Input
                  label="作者"
                  labelPlacement="outside"
                  radius="lg"
                  value={form.author}
                  onValueChange={(value) => updateField("author", value)}
                />
                <Input
                  label="发布日期"
                  labelPlacement="outside"
                  placeholder="YYYY-MM-DD"
                  radius="lg"
                  value={form.publishedAt}
                  onValueChange={(value) => updateField("publishedAt", value)}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                <Input
                  label="Accent"
                  labelPlacement="outside"
                  placeholder="linear-gradient(...)"
                  radius="lg"
                  value={form.accent}
                  onValueChange={(value) => updateField("accent", value)}
                />
                <label className="flex items-center gap-3 rounded-[1rem] border border-black/10 bg-white/70 px-4 py-3 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={form.draft}
                    onChange={(event) => {
                      updateDraftState(event.target.checked);
                    }}
                  />
                  保持草稿
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                <label className="flex items-center gap-3 rounded-[1rem] border border-black/10 bg-white/70 px-4 py-3 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    disabled={!canFeatureCurrentForm}
                    onChange={(event) => updateField("featured", event.target.checked)}
                  />
                  首页精选
                </label>
                <div className="rounded-[1rem] border border-black/10 bg-white/70 px-4 py-3 text-sm leading-7 text-[var(--muted)]">
                  {form.draft
                    ? "草稿不会出现在公开页面里，且不能被设为首页精选。"
                    : canFeatureCurrentForm
                      ? `公开页面最多可设置 3 篇首页精选，当前剩余 ${featuredSlotsRemaining} 个名额。`
                      : "已达到 3 篇首页精选上限；如需替换，先取消一篇当前精选。"}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg">
                      导入本地 md
                      <input
                        type="file"
                        accept=".md,.markdown,text/markdown"
                        className="hidden"
                        onChange={handleMarkdownImport}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/90">
                      导入本地 html
                      <input
                        type="file"
                        accept=".html,.htm,text/html"
                        className="hidden"
                        onChange={handleHTMLImport}
                      />
                    </label>
                    <span className="min-w-0 break-all">
                      {importedFileName
                        ? `已导入 ${importedFileName}，内容已同步到当前表单。`
                        : "Markdown 会直接读 frontmatter；HTML 文件会保存原始页面并在正文里生成一个可访问链接。"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--ink)]">图片工具</p>
                      <p className="text-xs leading-6 text-[var(--muted)]">
                        支持插入远程图片地址，也支持把本地 JPG、PNG、SVG、GIF、WebP 上传到站点的 /media 目录后自动插进当前正文格式；超过 8MB 的 JPG、PNG、WebP 会先在浏览器压缩。
                      </p>
                    </div>

                    <label
                      className={`inline-flex cursor-pointer rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/90 ${uploadingImage ? "pointer-events-none opacity-60" : ""}`}
                    >
                      {uploadingImage ? "处理中..." : "上传本地图片"}
                      <input
                        type="file"
                        accept="image/*,.svg,image/svg+xml"
                        className="hidden"
                        onChange={handleImageFileInsert}
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-end">
                    <Input
                      label="图片地址"
                      labelPlacement="outside"
                      placeholder="https://example.com/logo.svg 或 /media/2026/05/chart.png"
                      radius="lg"
                      value={imageUrl}
                      onValueChange={setImageUrl}
                    />
                    <Input
                      label="Alt 文本"
                      labelPlacement="outside"
                      placeholder="例如：压测结果曲线"
                      radius="lg"
                      value={imageAltText}
                      onValueChange={setImageAltText}
                    />
                    <Button
                      type="button"
                      radius="full"
                      variant="bordered"
                      isDisabled={imageUrl.trim().length === 0 || uploadingImage}
                      onPress={handleInsertImageByUrl}
                    >
                      插入图片
                    </Button>
                  </div>

                  <p className="text-xs leading-6 text-[var(--muted)]">
                    图片会插入到当前光标位置。上传接口会把文件写进站点共享媒体目录，并由 Redis 基于文件指纹做去重；重复上传会直接复用已有路径。SVG 会按原文件上传；GIF 超过 8MB 时仍需先手动压缩。
                  </p>

                  {imageStatus ? <p className="text-xs leading-6 text-emerald-700">{imageStatus}</p> : null}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-medium text-[var(--ink)]">正文格式</p>
                    <p className="text-xs leading-6 text-[var(--muted)]">
                      Markdown 继续沿用站内渲染链路；导入 HTML 文件时，系统会保留原始页面并在正文里生成一个预览链接，避免复杂 DOM 被站内正文渲染截断。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      radius="full"
                      size="sm"
                      variant={form.bodyFormat === "markdown" ? "solid" : "bordered"}
                      onPress={() => updateField("bodyFormat", "markdown")}
                    >
                      Markdown
                    </Button>
                    <Button
                      type="button"
                      radius="full"
                      size="sm"
                      variant={form.bodyFormat === "html" ? "solid" : "bordered"}
                      onPress={() => updateField("bodyFormat", "html")}
                    >
                      HTML
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-xs leading-6 text-[var(--muted)]">
                    {form.bodyFormat === "html"
                      ? "HTML 模式下只处理显式 data-math-expression 里的 TeX，不会改写 MathML 节点；$...$ / $$...$$ 包裹工具仅在 Markdown 下可用。"
                      : "包裹按钮会把当前选区包成 $...$ 或独立的 $$...$$ 公式块；标准化按钮只处理 $...$、$$...$$、\\(...\\)、\\[...\\] 里的公式，并跳过代码块或反引号代码。"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      radius="full"
                      size="sm"
                      variant="bordered"
                      isDisabled={form.bodyFormat !== "markdown"}
                      onPress={() => handleWrapBodySelection("inline")}
                    >
                      包成 $...$
                    </Button>
                    <Button
                      type="button"
                      radius="full"
                      size="sm"
                      variant="bordered"
                      isDisabled={form.bodyFormat !== "markdown"}
                      onPress={() => handleWrapBodySelection("block")}
                    >
                      包成 $$...$$
                    </Button>
                    <Button
                      type="button"
                      radius="full"
                      size="sm"
                      variant="bordered"
                      isDisabled={form.body.trim().length === 0}
                      onPress={handleNormalizeBodyLatex}
                    >
                      标准化 LaTeX
                    </Button>
                  </div>
                </div>

                {bodyToolStatus ? <p className="mt-3 text-xs leading-6 text-emerald-700">{bodyToolStatus}</p> : null}
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--ink)]">{form.bodyFormat === "html" ? "HTML 正文" : "Markdown 正文"}</span>
                <textarea
                  ref={bodyTextareaRef}
                  className="min-h-[24rem] w-full rounded-[1.5rem] border border-black/10 bg-white/70 px-4 py-4 text-sm leading-7 text-[var(--ink)] outline-none transition focus:border-black/30 focus:bg-white"
                  placeholder={form.bodyFormat === "html" ? "<article>\n  <h2>章节标题</h2>\n  <p>直接粘贴 HTML 正文。</p>\n</article>" : "# 标题\n\n先写背景、结论和关键数据"}
                  value={form.body}
                  onChange={(event) => updateField("body", event.target.value)}
                />
              </label>

              {isEditing && originalPost && hasPendingDiff ? (
                <Card className="border border-black/10 bg-white/65 shadow-none">
                  <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
                    <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Diff Preview</p>
                    <h2 className="display-type text-3xl text-[var(--ink)]">编辑前后 diff</h2>
                  </CardHeader>
                  <CardBody className="gap-4 px-5 pb-5 pt-4">
                    {metadataChanges.length > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {metadataChanges.map((change) => (
                          <div key={change.label} className="rounded-[1.25rem] border border-black/10 bg-white/75 p-4 text-sm leading-7 text-[var(--muted)]">
                            <p className="font-medium text-[var(--ink)]">{change.label}</p>
                            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Before</p>
                            <p>{change.before || "(空)"}</p>
                            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">After</p>
                            <p>{change.after || "(空)"}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {bodyDiff.length > 0 ? (
                      <div className="rounded-[1.25rem] border border-black/10 bg-white/75 p-4">
                        <p className="text-sm font-medium text-[var(--ink)]">正文行级 diff</p>
                        <div className="mt-3 space-y-2 font-mono text-xs leading-6 text-[var(--ink)]">
                          {bodyDiff.map((line, index) => (
                            <div
                              key={`${line.kind}-${index}-${line.text}`}
                              className={
                                line.kind === "add"
                                  ? "rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800"
                                  : "rounded-lg bg-rose-50 px-3 py-2 text-rose-800"
                              }
                            >
                              <span className="mr-2 inline-block w-4 font-semibold">{line.kind === "add" ? "+" : "-"}</span>
                              <span>{line.text || " "}</span>
                            </div>
                          ))}
                        </div>
                        {originalPost && buildBodyDiff(originalPost.body, form.body).length > 120 ? (
                          <p className="mt-3 text-xs leading-6 text-[var(--muted)]">正文 diff 已截断到前 120 行变更，避免后台页面过长。</p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  radius="full"
                  color="primary"
                  isDisabled={submitting || editorLoading || form.title.trim().length === 0 || form.body.trim().length === 0}
                >
                  {submitting ? (isEditing ? "更新中..." : "发布中...") : isEditing ? "保存修改" : "发布到站点"}
                </Button>
                {selectedSlug ? (
                  <Button
                    type="button"
                    radius="full"
                    variant="bordered"
                    onPress={() => {
                      resetEditor();
                    }}
                  >
                    取消编辑
                  </Button>
                ) : null}
                <Link
                  to="/"
                  className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
                >
                  返回首页
                </Link>
              </div>
            </form>
          </CardBody>
        </Card>

        <aside className="space-y-5">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Content List</p>
              <h2 className="display-type text-3xl text-[var(--ink)]">文章列表</h2>
            </CardHeader>
            <CardBody className="gap-4 px-5 pb-5 pt-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" radius="full" variant={listFilter === "all" ? "solid" : "bordered"} onPress={() => setListFilter("all")}>
                  全部
                </Button>
                <Button size="sm" radius="full" variant={listFilter === "published" ? "solid" : "bordered"} onPress={() => setListFilter("published")}>
                  已发布
                </Button>
                <Button size="sm" radius="full" variant={listFilter === "draft" ? "solid" : "bordered"} onPress={() => setListFilter("draft")}>
                  草稿
                </Button>
              </div>

              <div className="mt-3">
                <Input
                  placeholder="搜索标题、摘要、标签或 slug"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  radius="full"
                />
              </div>

              {searchQuery.trim().length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs leading-6 text-[var(--muted)]">
                  <Chip size="sm" variant="bordered">服务端全文检索</Chip>
                  <Chip size="sm" variant="bordered">本地子串过滤</Chip>
                  <span>当前展示 {visiblePosts.length} / {posts.length} 条</span>
                </div>
              ) : null}

              <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" radius="full" variant="bordered" onPress={toggleSelectAllVisible} isDisabled={visiblePosts.length === 0 || batchAction !== null}>
                    {allVisibleSelected ? "取消全选" : `全选当前(${visiblePosts.length})`}
                  </Button>
                  <Button
                    size="sm"
                    radius="full"
                    variant="bordered"
                    isDisabled={selectedSlugs.length === 0 || batchAction !== null}
                    onPress={() => {
                      void handleBatchAction("publish");
                    }}
                  >
                    {batchAction === "publish" ? "处理中..." : "批量发布"}
                  </Button>
                  <Button
                    size="sm"
                    radius="full"
                    variant="bordered"
                    color="warning"
                    isDisabled={selectedSlugs.length === 0 || batchAction !== null}
                    onPress={() => {
                      void handleBatchAction("draft");
                    }}
                  >
                    {batchAction === "draft" ? "处理中..." : "批量转草稿"}
                  </Button>
                  <Button
                    size="sm"
                    radius="full"
                    variant="light"
                    color="warning"
                    isDisabled={selectedSlugs.length === 0 || batchAction !== null}
                    onPress={() => {
                      void handleBatchAction("delete");
                    }}
                  >
                    {batchAction === "delete" ? "处理中..." : "批量删除"}
                  </Button>
                  {selectedSlugs.length > 0 ? <Chip variant="bordered">已选 {selectedSlugs.length}</Chip> : null}
                </div>
              </div>

              {postsLoading ? (
                <div className="flex min-h-40 items-center justify-center rounded-[1.5rem] border border-dashed border-black/10 bg-white/40">
                  <Spinner color="warning" label="正在加载文章列表" labelColor="warning" />
                </div>
              ) : null}

              {!postsLoading && visiblePosts.length === 0 ? (
                <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                  当前筛选下没有文章。可以切换筛选条件，或者先从左侧新建一篇草稿。
                </div>
              ) : null}

              {!postsLoading
                ? visiblePosts.map((post) => (
                    <div
                      key={post.slug}
                      className={
                        selectedSlug === post.slug
                          ? "rounded-[1.5rem] border border-black/20 bg-[rgba(15,118,110,0.08)] p-4"
                          : "rounded-[1.5rem] border border-black/10 bg-white/70 p-4"
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-black/20"
                            checked={selectedSlugs.includes(post.slug)}
                            onChange={() => toggleSelectedSlug(post.slug)}
                          />
                          <button type="button" className="text-left" onClick={() => { void handleEditPost(post.slug); }}>
                            <span className="block text-sm font-semibold text-[var(--ink)]">{renderHighlighted(post.title)}</span>
                            <span className="mt-1 block text-xs leading-6 text-[var(--muted)]">
                              {formatPublishDate(post.publishedAt)} · {post.category} · {post.readMinutes} 分钟阅读
                            </span>
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {post.draft ? <Chip size="sm" variant="bordered">草稿</Chip> : <Chip size="sm" color="secondary" variant="flat">已发布</Chip>}
                          {post.featured ? <Chip size="sm" color="warning" variant="flat">置顶</Chip> : null}
                          {searchQuery.trim().length > 0 && post.searchMode ? (
                            <Chip size="sm" variant="bordered">{post.searchMode === "text" ? "全文" : "模糊"}</Chip>
                          ) : null}
                          {searchQuery.trim().length > 0 && formatSearchScore(post.searchScore) ? (
                            <Chip size="sm" color="warning" variant="flat">相关度 {formatSearchScore(post.searchScore)}</Chip>
                          ) : null}
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{renderHighlighted(post.summary)}</p>

                      {searchQuery.trim().length > 0 && post.searchSnippet ? (
                        <div className="mt-3 rounded-[1rem] border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs leading-6 text-amber-900">
                          <p className="font-medium text-amber-800">匹配片段 · {post.searchSnippet.label}</p>
                          <p
                            className="mt-1 [&_mark]:rounded [&_mark]:bg-amber-200 [&_mark]:px-1"
                            dangerouslySetInnerHTML={{ __html: post.searchSnippet.html }}
                          />
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          radius="full"
                          variant={selectedSlug === post.slug ? "solid" : "bordered"}
                          isDisabled={editorLoading || actingSlug === post.slug || submitting}
                          onPress={() => { void handleEditPost(post.slug); }}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          radius="full"
                          variant={post.featured ? "light" : "bordered"}
                          color="warning"
                          isDisabled={post.draft || editorLoading || actingSlug === post.slug || submitting || batchAction !== null || (!post.featured && featuredLimitReached)}
                          onPress={() => { void handleToggleFeatured(post); }}
                        >
                          {actingSlug === post.slug ? "处理中..." : post.featured ? "取消置顶" : featuredLimitReached ? "已达上限" : "设为置顶"}
                        </Button>
                        {!post.draft ? (
                          <Link
                            to={`/posts/${post.slug}`}
                            className="inline-flex items-center justify-center rounded-full border border-black/10 px-3 py-1.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/90"
                          >
                            预览
                          </Link>
                        ) : null}
                        <Button
                          size="sm"
                          radius="full"
                          variant="light"
                          color="warning"
                          isDisabled={editorLoading || actingSlug === post.slug || submitting || batchAction !== null}
                          onPress={() => { void handleDeletePost(post); }}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                : null}
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Markdown Tips</p>
              <h2 className="display-type text-3xl text-[var(--ink)]">写作提示</h2>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
              <p>支持标题、列表、引用、代码块、表格和任务列表，适合贴 benchmark 表、命令片段和排障步骤。</p>
              <p>摘要可以留空，系统会从正文自动提取一段作为列表卡片描述。</p>
              <p>Slug 也可以留空；如果标题里有中文，会直接保留中文 slug。</p>
              <p>导入本地 md 时，会优先解析 YAML frontmatter 里的标题、标签、作者、日期和 featured。</p>
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Workflow</p>
              <h2 className="display-type text-3xl text-[var(--ink)]">后台操作</h2>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
              <p>1. 新建内容默认先走草稿，确认后再取消草稿公开发布。</p>
              <p>2. 右侧支持多选批量发布、批量转草稿和批量删除。</p>
              <p>3. 编辑现有文章时，左侧会显示元数据变化和正文行级 diff。</p>
              <p>4. 首页置顶按单篇生效；草稿不能置顶，设新置顶时旧置顶会自动取消。</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}