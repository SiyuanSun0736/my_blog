import { Avatar, Card, CardBody, Chip, Divider, Spinner } from "../components/ui";
import { useEffect, useState } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Link, useParams } from "react-router-dom";
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

export function PostPage() {
  const { slug = "" } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [postSummaries, setPostSummaries] = useState<PostSummary[]>([]);
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
    <article className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-5">
        <Link to="/" className="inline-flex text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink)]">
          返回首页文章流
        </Link>
        <div className="overflow-hidden rounded-[2.25rem] border border-black/10 bg-[var(--panel-strong)] shadow-[0_32px_100px_rgba(77,53,35,0.12)]">
          <div className="h-4 w-full" style={{ background: post.accent }} />
          <div className="space-y-8 px-6 py-7 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
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

              <h1 className="display-type max-w-4xl text-4xl leading-tight text-[var(--ink)] sm:text-5xl lg:text-6xl">
                {post.title}
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                {post.summary}
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-4 rounded-[1.75rem] border border-black/10 bg-white/65 p-5 sm:grid-cols-3">
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

              <div className="flex items-center gap-4 rounded-[1.75rem] border border-black/10 bg-white/60 p-4">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="glass-panel border border-black/10 shadow-[0_24px_80px_rgba(75,54,34,0.08)]">
          <CardBody className="space-y-8 p-6 sm:p-8 lg:p-10">
            <div className="story-prose">
              <ReactMarkdown rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath, remarkGfm]}>
                {post.body}
              </ReactMarkdown>
            </div>

            <Divider />

            {previousPost || nextPost ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Keep Reading</p>
                  <h2 className="display-type mt-2 text-3xl text-[var(--ink)]">沿时间线继续</h2>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {previousPost ? (
                    <Link
                      to={`/posts/${previousPost.slug}`}
                      className="rounded-[1.5rem] border border-black/10 bg-white/70 px-5 py-4 transition hover:-translate-y-0.5 hover:border-black/30"
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
                    <div className="rounded-[1.5rem] border border-dashed border-black/10 bg-white/40 px-5 py-4 text-sm leading-7 text-[var(--muted)]">
                      这已经是当前时间线里最早的一篇记录。
                    </div>
                  )}

                  {nextPost ? (
                    <Link
                      to={`/posts/${nextPost.slug}`}
                      className="rounded-[1.5rem] border border-black/10 bg-white/70 px-5 py-4 transition hover:-translate-y-0.5 hover:border-black/30"
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
                    <div className="rounded-[1.5rem] border border-dashed border-black/10 bg-white/40 px-5 py-4 text-sm leading-7 text-[var(--muted)]">
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
                    <h2 className="display-type mt-2 text-3xl text-[var(--ink)]">同主题延伸</h2>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {relatedPosts.map((relatedPost) => (
                      <Link
                        key={relatedPost.slug}
                        to={`/posts/${relatedPost.slug}`}
                        className="rounded-[1.5rem] border border-black/10 bg-white/70 px-5 py-4 transition hover:-translate-y-0.5 hover:border-black/30"
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
                className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                回首页继续翻
              </Link>
            </div>
          </CardBody>
        </Card>

        <aside className="space-y-5">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-3 p-5">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">文章信息</p>
              <div className="space-y-2 text-sm leading-7 text-[var(--muted)]">
                <p>作者：{post.author}</p>
                <p>分类：{post.category}</p>
                <p>阅读时长：约 {post.readMinutes} 分钟</p>
              </div>
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-3 p-5">
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
            <CardBody className="gap-3 p-5 text-sm leading-7 text-[var(--muted)]">
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">继续阅读</p>
              <p>读完后回首页继续看最新记录，或者沿标签与归档把同主题的内容继续串起来。</p>
              <Link
                to="/"
                className="inline-flex rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
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