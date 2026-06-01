import { Avatar, Card, CardBody, Chip, Divider, Spinner } from "../components/ui";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PostContent, type PostHeading } from "../components/PostContent";
import { fetchPost, fetchPosts } from "../lib/api";
import type { Post, PostSummary } from "../types";

function sortPostsByDate(posts: PostSummary[]) {
  return [...posts].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
}

function buildRelatedPosts(currentPost: Post, posts: PostSummary[]) {
  const scoredPosts = posts
    .filter((candidate) => candidate.slug !== currentPost.slug)
    .map((candidate) => {
      const sharedTagCount = candidate.tags.filter((tag) => currentPost.tags.includes(tag)).length;
      const score = (candidate.category === currentPost.category ? 4 : 0) + sharedTagCount * 2;

      return { post: candidate, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Date.parse(right.post.publishedAt) - Date.parse(left.post.publishedAt);
    });

  const matchedPosts = scoredPosts
    .filter((candidate) => candidate.score > 0)
    .slice(0, 3)
    .map((candidate) => candidate.post);

  if (matchedPosts.length > 0) {
    return matchedPosts;
  }

  return posts.filter((candidate) => candidate.slug !== currentPost.slug).slice(0, 3);
}

function normalizeHeadingLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function tableOfContentsIndent(level: PostHeading["level"]) {
  switch (level) {
    case 2:
      return "pl-3";
    case 3:
      return "pl-6";
    case 4:
      return "pl-9";
    default:
      return "";
  }
}

export function PostPage() {
  const { slug = "" } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [postSummaries, setPostSummaries] = useState<PostSummary[]>([]);
  const [contentHeadings, setContentHeadings] = useState<PostHeading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setContentHeadings([]);
    Promise.allSettled([fetchPost(slug), fetchPosts()])
      .then(([postResult, postsResult]) => {
        if (cancelled) {
          return;
        }

        if (postResult.status === "fulfilled") {
          setPost(postResult.value);
        } else {
          const requestError = postResult.reason;
          setError(requestError instanceof Error ? requestError.message : "文章加载失败");
        }

        if (postsResult.status === "fulfilled") {
          setPostSummaries(postsResult.value);
        } else {
          setPostSummaries([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const sortedPosts = sortPostsByDate(postSummaries);
  const currentIndex = sortedPosts.findIndex((entry) => entry.slug === slug);
  const previousPost = currentIndex > 0 ? sortedPosts[currentIndex - 1] : null;
  const nextPost = currentIndex >= 0 && currentIndex < sortedPosts.length - 1 ? sortedPosts[currentIndex + 1] : null;
  const relatedPosts = post ? buildRelatedPosts(post, sortedPosts) : [];
  const tableOfContents = post
    ? contentHeadings.filter((heading, index) => !(index === 0 && normalizeHeadingLabel(heading.text) === normalizeHeadingLabel(post.title)))
    : [];

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner color="primary" label="正在加载文章内容" labelColor="primary" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <Card className="mx-auto max-w-3xl border border-danger/30 bg-danger-50">
        <CardBody className="gap-4 p-8 text-sm text-danger-700">
          <p>文章加载失败：{error ?? "未找到对应文章"}</p>
          <Link to="/" className="font-medium text-danger-700 underline underline-offset-4">
            返回首页
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <article className="reading-frame space-y-5 sm:space-y-8">
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="inline-flex text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink)]">
            返回首页文章流
          </Link>
          <a
            href={`/posts/${post.slug}/pdf`}
            className="inline-flex w-full justify-center rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:w-auto"
          >
            下载 PDF
          </a>
        </div>
        <div className="overflow-hidden rounded-[1.75rem] border border-black/10 bg-[var(--panel-strong)] shadow-[0_22px_60px_rgba(77,53,35,0.12)] sm:rounded-[2.25rem] sm:shadow-[0_32px_100px_rgba(77,53,35,0.12)]">
          <div className="h-3 w-full sm:h-4" style={{ background: post.accent }} />
          <div className="space-y-5 px-4 py-5 sm:space-y-7 sm:px-6 sm:py-6 lg:px-8 lg:py-8 xl:px-10 xl:py-10">
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted)]">Wanderlust Notes</p>
              <div className="flex flex-wrap gap-2">
                <Chip color="secondary" variant="flat">
                  {post.category}
                </Chip>
                {post.featured ? (
                  <Chip color="warning" variant="bordered">
                    编辑精选
                  </Chip>
                ) : null}
                {post.tags.map((tag) => (
                  <Chip key={tag} variant="light" size="sm">
                    #{tag}
                  </Chip>
                ))}
              </div>

              <h1 className="display-type max-w-5xl text-[clamp(2rem,5.8vw,4.6rem)] leading-[1.02] text-[var(--ink)] sm:leading-[1.06]">
                {post.title}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-[var(--muted)] sm:text-lg sm:leading-8">
                {post.summary}
              </p>
            </div>

            <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(16rem,24vw,20rem)]">
              <div className="grid gap-4 rounded-[1.35rem] border border-black/10 bg-white/65 p-4 sm:rounded-[1.75rem] sm:p-5 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">发布时间</p>
                  <p className="mt-2 text-sm font-medium text-[var(--ink)]">{formatPublishDate(post.publishedAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">阅读时长</p>
                  <p className="mt-2 text-sm font-medium text-[var(--ink)]">{post.readMinutes} 分钟</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">所属栏目</p>
                  <p className="mt-2 text-sm font-medium text-[var(--ink)]">{post.category}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-[1.35rem] border border-black/10 bg-white/60 p-4 sm:gap-4 sm:rounded-[1.75rem]">
                <Avatar name={post.author} color="primary" className="text-white" />
                <div>
                  <p className="font-medium text-[var(--ink)]">{post.author}</p>
                  <p className="text-sm text-[var(--muted)]">工程日志作者</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_clamp(16rem,21vw,19rem)]">
        <Card className="glass-panel border border-black/10 shadow-[0_24px_80px_rgba(75,54,34,0.08)]">
          <CardBody className="space-y-6 p-4 sm:space-y-8 sm:p-7 lg:p-8 xl:p-10">
            <PostContent body={post.body} bodyFormat={post.bodyFormat} onHeadingsChange={setContentHeadings} />

            <Divider />

            {previousPost || nextPost ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Keep Reading</p>
                  <h2 className="display-type mt-2 text-[1.75rem] text-[var(--ink)] sm:text-3xl">沿时间线继续</h2>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {previousPost ? (
                    <Link
                      to={`/posts/${previousPost.slug}`}
                      className="rounded-[1.35rem] border border-black/10 bg-white/70 px-4 py-4 transition hover:-translate-y-0.5 hover:border-black/30 sm:rounded-[1.5rem] sm:px-5"
                    >
                      <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">上一篇</span>
                      <span className="mt-3 block text-lg font-medium leading-7 text-[var(--ink)]">
                        {previousPost.title}
                      </span>
                      <span className="mt-2 block text-sm leading-7 text-[var(--muted)]">
                        {formatPublishDate(previousPost.publishedAt)} · {previousPost.category}
                      </span>
                    </Link>
                  ) : (
                    <div className="rounded-[1.35rem] border border-dashed border-black/10 bg-white/40 px-4 py-4 text-sm leading-7 text-[var(--muted)] sm:rounded-[1.5rem] sm:px-5">
                      这已经是当前时间线里最早的一篇记录。
                    </div>
                  )}

                  {nextPost ? (
                    <Link
                      to={`/posts/${nextPost.slug}`}
                      className="rounded-[1.35rem] border border-black/10 bg-white/70 px-4 py-4 transition hover:-translate-y-0.5 hover:border-black/30 sm:rounded-[1.5rem] sm:px-5"
                    >
                      <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">下一篇</span>
                      <span className="mt-3 block text-lg font-medium leading-7 text-[var(--ink)]">
                        {nextPost.title}
                      </span>
                      <span className="mt-2 block text-sm leading-7 text-[var(--muted)]">
                        {formatPublishDate(nextPost.publishedAt)} · {nextPost.category}
                      </span>
                    </Link>
                  ) : (
                    <div className="rounded-[1.35rem] border border-dashed border-black/10 bg-white/40 px-4 py-4 text-sm leading-7 text-[var(--muted)] sm:rounded-[1.5rem] sm:px-5">
                      这已经是当前时间线里最新的一篇记录。
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {relatedPosts.length > 0 ? (
              <>
                <Divider />

                <div className="space-y-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Related Reading</p>
                    <h2 className="display-type mt-2 text-[1.75rem] text-[var(--ink)] sm:text-3xl">同主题延伸</h2>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {relatedPosts.map((relatedPost) => (
                      <Link
                        key={relatedPost.slug}
                        to={`/posts/${relatedPost.slug}`}
                        className="rounded-[1.35rem] border border-black/10 bg-white/70 px-4 py-4 transition hover:-translate-y-0.5 hover:border-black/30 sm:rounded-[1.5rem] sm:px-5"
                      >
                        <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                          {relatedPost.category} · {relatedPost.readMinutes} 分钟阅读
                        </span>
                        <span className="mt-3 block text-lg font-medium leading-7 text-[var(--ink)]">
                          {relatedPost.title}
                        </span>
                        <span className="mt-2 block text-sm leading-7 text-[var(--muted)]">
                          {relatedPost.summary}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            <Divider />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">阅读完这篇</p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                  如果这个方向还值得继续追，可以回到首页按同标签、同栏目或相邻时间继续看下去。
                </p>
              </div>
              <Link
                to="/"
                className="inline-flex w-full justify-center rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:w-auto"
              >
                回首页继续翻
              </Link>
            </div>
          </CardBody>
        </Card>

        <aside className="space-y-4 self-start sm:space-y-5 xl:sticky xl:top-24 xl:max-h-[calc(100svh-7.5rem)] xl:overflow-y-auto xl:pr-1">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-4 p-4 sm:p-5">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">目录</p>
                <p className="text-sm leading-7 text-[var(--muted)]">
                  {tableOfContents.length > 0 ? "点击标题可跳到正文对应位置。" : "本篇正文没有可提取的章节标题。"}
                </p>
              </div>

              {tableOfContents.length > 0 ? (
                <nav aria-label="文章目录" className="max-h-[20rem] overflow-y-auto pr-1 sm:max-h-[24rem] xl:max-h-[calc(100svh-10rem)]">
                  <ol className="space-y-1.5">
                    {tableOfContents.map((heading) => (
                      <li key={heading.id}>
                        <a
                          href={`#${heading.id}`}
                          className={`block rounded-[0.9rem] px-3 py-2 text-sm leading-6 text-[var(--muted)] transition hover:bg-white/70 hover:text-[var(--ink)] ${tableOfContentsIndent(heading.level)}`}
                        >
                          {heading.text}
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-3 p-4 sm:p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">文章信息</p>
              <div className="space-y-2 text-sm leading-7 text-[var(--muted)]">
                <p>作者：{post.author}</p>
                <p>分类：{post.category}</p>
                <p>阅读时长：约 {post.readMinutes} 分钟</p>
              </div>
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-3 p-4 sm:p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">标签</p>
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Chip key={tag} variant="light" size="sm">
                    #{tag}
                  </Chip>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-3 p-4 text-sm leading-7 text-[var(--muted)] sm:p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">继续阅读</p>
              <p>读完后回首页继续看最新记录，或者沿标签与归档把同主题的内容继续串起来。</p>
              <Link
                to="/"
                className="inline-flex w-full justify-center rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg sm:w-auto sm:justify-start sm:py-2"
              >
                回首页
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </article>
  );
}