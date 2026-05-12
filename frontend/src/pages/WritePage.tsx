import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPost, verifyWriteAccess } from "../lib/api";

interface WriteFormState {
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string;
  author: string;
  publishedAt: string;
  accent: string;
  body: string;
  featured: boolean;
}

const defaultAccent = "linear-gradient(135deg, #0f766e 0%, #f59e0b 100%)";
const writeTokenStorageKey = "wanderlust:write-token";

interface FrontmatterData {
  title?: string;
  slug?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  author?: string;
  publishedAt?: string;
  accent?: string;
  featured?: boolean;
}

function normalizeMarkdownLineEndings(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseFrontmatterValue(value: string): string | boolean | string[] {
  const trimmedValue = stripQuotes(value.trim());
  if (trimmedValue === "true") {
    return true;
  }

  if (trimmedValue === "false") {
    return false;
  }

  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    return trimmedValue
      .slice(1, -1)
      .split(",")
      .map((entry) => stripQuotes(entry.trim()))
      .filter(Boolean);
  }

  return trimmedValue;
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
  const frontmatter: FrontmatterData = {};
  let currentListKey: keyof FrontmatterData | null = null;

  frontmatterBlock.split("\n").forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      return;
    }

    const listItemMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (listItemMatch && currentListKey) {
      const previousItems = Array.isArray(frontmatter[currentListKey])
        ? [...(frontmatter[currentListKey] as string[])]
        : [];
      frontmatter[currentListKey] = [...previousItems, stripQuotes(listItemMatch[1].trim())] as never;
      return;
    }

    currentListKey = null;
    const separatorIndex = trimmedLine.indexOf(":");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim() as keyof FrontmatterData;
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    if (rawValue === "") {
      currentListKey = key;
      frontmatter[key] = [] as never;
      return;
    }

    frontmatter[key] = parseFrontmatterValue(rawValue) as never;
  });

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

export function WritePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<WriteFormState>({
    title: "",
    slug: "",
    summary: "",
    category: "Wanderlust Notes",
    tags: "",
    author: "Wanderlust",
    publishedAt: new Date().toISOString().slice(0, 10),
    accent: defaultAccent,
    body: "# 新文章标题\n\n在这里开始写正文。",
    featured: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeToken, setWriteToken] = useState("");
  const [accessVerified, setAccessVerified] = useState(false);
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem(writeTokenStorageKey);
    if (!storedToken) {
      return;
    }

    setWriteToken(storedToken);
    void handleVerifyAccess(storedToken, true);
  }, []);

  function updateField<Key extends keyof WriteFormState>(field: Key, value: WriteFormState[Key]) {
    setForm((current) => ({
      ...current,
      [field]: value,
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
    window.sessionStorage.removeItem(writeTokenStorageKey);
    setWriteToken("");
    setAccessVerified(false);
    setAccessMessage("已清除当前浏览器会话里的写作令牌。");
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
        featured: typeof frontmatter.featured === "boolean" ? frontmatter.featured : current.featured,
        body: resolvedBody || current.body,
      }));
      setImportedFileName(file.name);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "本地 Markdown 导入失败。");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const hasAccess = accessVerified || (await handleVerifyAccess());
      if (!hasAccess) {
        setError("写作令牌无效，无法发布文章。");
        return;
      }

      const post = await createPost({
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
        featured: form.featured,
        accent: form.accent || undefined,
        body: form.body,
      }, writeToken.trim());

      navigate(`/posts/${post.slug}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发布失败，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_340px]">
      <Card className="overflow-hidden border border-black/10 bg-[var(--panel-strong)] shadow-[0_30px_90px_rgba(77,53,35,0.12)]">
        <div className="h-3 w-full bg-[linear-gradient(90deg,#0f766e_0%,#f59e0b_100%)]" />
        <CardHeader className="flex flex-col items-start gap-4 px-6 pb-0 pt-6 sm:px-8 sm:pt-8">
          <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">Wanderlust Writer</p>
          <div className="max-w-3xl space-y-4">
            <h1 className="display-type text-4xl leading-none text-[var(--ink)] sm:text-5xl">
              直接写进站点，不再靠默认 seed 撑首页。
            </h1>
            <p className="max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
              这里是新的写作入口。正文接受 Markdown，提交后会直接生成文章详情页，适合把本地 md 草稿贴进来继续整理。
            </p>
          </div>
        </CardHeader>

        <CardBody className="px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                <Input
                  type="password"
                  label="写作令牌"
                  labelPlacement="outside"
                  placeholder="输入 BLOG_WRITE_TOKEN"
                  radius="lg"
                  value={writeToken}
                  onValueChange={setWriteToken}
                />
                <Button
                  type="button"
                  radius="full"
                  color={accessVerified ? "success" : "primary"}
                  isDisabled={verifyingAccess || writeToken.trim().length === 0}
                  onPress={() => {
                    void handleVerifyAccess();
                  }}
                >
                  {verifyingAccess ? "验证中..." : accessVerified ? "已解锁" : "验证令牌"}
                </Button>
                <Button
                  type="button"
                  radius="full"
                  variant="light"
                  isDisabled={verifyingAccess && !accessVerified}
                  onPress={clearWriteAccess}
                >
                  清除令牌
                </Button>
              </div>

              <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
                {accessVerified
                  ? "当前浏览器会话已通过写作鉴权，创建文章请求会自动附带 Bearer token。"
                  : "公开暴露写作入口时，先用服务端的 BLOG_WRITE_TOKEN 验证当前会话。"}
              </p>

              {accessMessage ? (
                <div
                  className={
                    accessVerified
                      ? "mt-3 rounded-[1rem] border border-success/30 bg-success-50 px-4 py-3 text-sm text-success-700"
                      : "mt-3 rounded-[1rem] border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"
                  }
                >
                  {accessMessage}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="标题"
                labelPlacement="outside"
                placeholder="例如：我终于把博客写作流程收顺了"
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
              placeholder="可选，留空会从 Markdown 正文自动截取"
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
                placeholder="多个标签用逗号分隔"
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
                  checked={form.featured}
                  onChange={(event) => updateField("featured", event.target.checked)}
                />
                首页精选
              </label>
            </div>

            <div className="rounded-[1.5rem] border border-black/10 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
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
                <span>
                  {importedFileName
                    ? `已导入 ${importedFileName}，frontmatter 与正文已同步到表单。`
                    : "支持直接选择本地 Markdown 文件，避免手动粘贴。"}
                </span>
              </div>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Markdown 正文</span>
              <textarea
                className="min-h-[24rem] w-full rounded-[1.5rem] border border-black/10 bg-white/70 px-4 py-4 text-sm leading-7 text-[var(--ink)] outline-none transition focus:border-black/30 focus:bg-white"
                placeholder="# 标题\n\n开始写正文"
                value={form.body}
                onChange={(event) => updateField("body", event.target.value)}
              />
            </label>

            {error ? (
              <div className="rounded-[1.25rem] border border-danger/30 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                radius="full"
                color="primary"
                isDisabled={submitting || form.title.trim().length === 0 || form.body.trim().length === 0}
              >
                {submitting ? "发布中..." : "发布文章"}
              </Button>
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
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Markdown Tips</p>
            <h2 className="display-type text-3xl text-[var(--ink)]">写作提示</h2>
          </CardHeader>
          <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
            <p>支持标题、列表、引用、代码块、表格和任务列表。</p>
            <p>摘要可以留空，系统会从正文自动提取一段作为列表卡片描述。</p>
            <p>Slug 也可以留空；如果标题里有中文，会直接保留中文 slug。</p>
            <p>导入本地 md 时，会优先解析 YAML frontmatter 里的标题、标签、作者、日期和 featured。</p>
          </CardBody>
        </Card>

        <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
          <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
            <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Workflow</p>
            <h2 className="display-type text-3xl text-[var(--ink)]">发布流程</h2>
          </CardHeader>
          <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
            <p>1. 填标题和正文。</p>
            <p>2. 可选补分类、标签、摘要和 accent。</p>
            <p>3. 提交后会直接跳到文章详情页，前台按 Markdown 渲染。</p>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}