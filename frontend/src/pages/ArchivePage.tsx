import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner } from "../components/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPosts } from "../lib/api";
import { renderHighlightedText } from "../lib/searchHighlight";
import type { PostSummary } from "../types";

const archiveFilterAll = "全部";

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

function formatArchiveLabel(dateString: string) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function normalizeTags(tags: string[]) {
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function normalizeArchiveFilterValue(value: string | null) {
  const normalized = value?.trim();

  return normalized ? normalized : archiveFilterAll;
}

function normalizeArchiveKeywordValue(value: string | null) {
  return value?.trim() ?? "";
}

function createArchiveSearchParams(year: string, tag: string, keyword: string) {
  const params = new URLSearchParams();

  if (year !== archiveFilterAll) {
    params.set("year", year);
  }

  if (tag !== archiveFilterAll) {
    params.set("tag", tag);
  }

  if (keyword.trim().length > 0) {
    params.set("q", keyword.trim());
  }

  return params;
}

export function ArchivePage() {
  const searchRequestRef = useRef(0);
  const [allPosts, setAllPosts] = useState<PostSummary[]>([]);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [serverKeyword, setServerKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    fetchPosts()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setAllPosts(items);
        setPosts(items);
        setServerKeyword("");
        setError(null);
      })
      .catch((requestError: Error) => {
        if (!cancelled) {
          setError(requestError.message);
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
  }, []);

  const allSortedPosts = [...allPosts].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  const years = [
    archiveFilterAll,
    ...new Set(allSortedPosts.map((post) => String(new Date(post.publishedAt).getFullYear()))),
  ];
  const tagArchive = [...allSortedPosts.reduce<Map<string, number>>((counts, post) => {
    normalizeTags(post.tags).forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });

    return counts;
  }, new Map()).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([tag, count]) => ({ tag, count }));
  const requestedYear = normalizeArchiveFilterValue(searchParams.get("year"));
  const requestedTag = normalizeArchiveFilterValue(searchParams.get("tag"));
  const requestedKeyword = normalizeArchiveKeywordValue(searchParams.get("q"));
  const activeYear =
    requestedYear === archiveFilterAll || years.includes(requestedYear) ? requestedYear : archiveFilterAll;
  const activeTag =
    requestedTag === archiveFilterAll || tagArchive.some((entry) => entry.tag === requestedTag)
      ? requestedTag
      : archiveFilterAll;
  const activeKeyword = requestedKeyword;
  const normalizedActiveKeyword = activeKeyword.toLowerCase();
  const normalizedServerKeyword = serverKeyword.trim().toLowerCase();
  const searchBasePosts = normalizedActiveKeyword.length > 0 && normalizedActiveKeyword === normalizedServerKeyword
    ? posts
    : allSortedPosts;

  function updateArchiveFilters(nextYear: string, nextTag: string, nextKeyword = activeKeyword) {
    setSearchParams(createArchiveSearchParams(nextYear, nextTag, nextKeyword), { replace: true });
  }

  useEffect(() => {
    if (loading) {
      return;
    }

    if (activeKeyword.length === 0) {
      searchRequestRef.current += 1;
      setPosts(allPosts);
      setServerKeyword("");
      setSearchLoading(false);
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchLoading(true);

    const timer = window.setTimeout(() => {
      fetchPosts(activeKeyword)
        .then((items) => {
          if (requestId !== searchRequestRef.current) {
            return;
          }

          setPosts(items);
          setServerKeyword(activeKeyword);
          setError(null);
        })
        .catch((requestError: Error) => {
          if (requestId !== searchRequestRef.current) {
            return;
          }

          setError(requestError.message);
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) {
            setSearchLoading(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeKeyword, allPosts, loading]);

  useEffect(() => {
    if (loading || error) {
      return;
    }

    if (requestedYear === activeYear && requestedTag === activeTag) {
      return;
    }

    setSearchParams(createArchiveSearchParams(activeYear, activeTag, activeKeyword), { replace: true });
  }, [activeKeyword, activeTag, activeYear, error, loading, requestedTag, requestedYear, setSearchParams]);

  const filteredPosts = searchBasePosts.filter((post) => {
    const matchesYear =
      activeYear === archiveFilterAll || String(new Date(post.publishedAt).getFullYear()) === activeYear;
    const matchesTag = activeTag === archiveFilterAll || normalizeTags(post.tags).includes(activeTag);
    const matchesKeyword =
      normalizedActiveKeyword.length === 0 ||
      post.title.toLowerCase().includes(normalizedActiveKeyword) ||
      post.summary.toLowerCase().includes(normalizedActiveKeyword) ||
      post.category.toLowerCase().includes(normalizedActiveKeyword) ||
      post.author.toLowerCase().includes(normalizedActiveKeyword) ||
      normalizeTags(post.tags).some((tag) => tag.toLowerCase().includes(normalizedActiveKeyword)) ||
      (post.searchSnippet?.text ?? "").toLowerCase().includes(normalizedActiveKeyword);

    return matchesYear && matchesTag && matchesKeyword;
  });
  const currentYearLabel = activeYear === archiveFilterAll ? "全部年份" : `${activeYear} 年`;
  const currentTagLabel = activeTag === archiveFilterAll ? "全部标签" : `#${activeTag}`;
  const currentKeywordLabel = activeKeyword.length > 0 ? `“${activeKeyword}”` : "未启用";
  const formatSearchScore = (score: number | undefined) => {
    if (typeof score !== "number" || Number.isNaN(score)) {
      return null;
    }

    return score >= 10 ? score.toFixed(1) : score.toFixed(2);
  };
  const archiveGroups = filteredPosts.reduce<Array<{ key: string; label: string; posts: PostSummary[] }>>(
    (groups, post) => {
      const key = post.publishedAt.slice(0, 7);
      const previousGroup = groups[groups.length - 1];

      if (!previousGroup || previousGroup.key !== key) {
        groups.push({
          key,
          label: formatArchiveLabel(post.publishedAt),
          posts: [post],
        });

        return groups;
      }

      previousGroup.posts.push(post);
      return groups;
    },
    [],
  );

  return (
    <div className="space-y-8 lg:space-y-10">
      <section className="overflow-hidden rounded-[2.25rem] border border-black/10 bg-[var(--panel-strong)] shadow-[0_30px_90px_rgba(77,53,35,0.12)]">
        <div className="h-3 w-full bg-[linear-gradient(90deg,#0f766e_0%,#d96c3d_100%)]" />
        <div className="space-y-5 px-6 py-7 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <Chip color="secondary" variant="flat">
            时间线归档
          </Chip>
          <div className="max-w-3xl space-y-4">
            <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">按年份筛选 / 按标签归档 / 按月份折叠</p>
            <h1 className="display-type text-4xl leading-none text-[var(--ink)] sm:text-5xl lg:text-6xl">
              历史记录
            </h1>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_320px]">
        <div className="space-y-6">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Archive Search</p>
                  <h2 className="display-type text-4xl text-[var(--ink)]">年份筛选</h2>
                </div>
                <p className="text-sm text-[var(--muted)]">当前查看 {currentYearLabel} / {currentTagLabel} / {currentKeywordLabel}</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--ink)]">关键词搜索</p>
                <Input
                  aria-label="搜索归档文章"
                  placeholder="输入关键词，例如：SSA、perf、CUDA、Makefile、Kubernetes"
                  radius="lg"
                  value={activeKeyword}
                  onValueChange={(value) => updateArchiveFilters(activeYear, activeTag, value)}
                />
                {normalizedActiveKeyword.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs leading-6 text-[var(--muted)]">
                    <Chip size="sm" variant="bordered">服务端全文检索</Chip>
                    <Chip size="sm" variant="bordered">本地即时筛选</Chip>
                    <span>
                      {searchLoading
                        ? "正在刷新相关度排序..."
                        : normalizedServerKeyword === normalizedActiveKeyword
                          ? `当前展示 ${filteredPosts.length} 条相关结果`
                          : "先按本地匹配即时筛选，再更新为服务端相关度结果"}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {years.map((year) => (
                  <Button
                    key={year}
                    radius="full"
                    size="sm"
                    variant={year === activeYear ? "solid" : "bordered"}
                    color={year === activeYear ? "primary" : "default"}
                    aria-pressed={year === activeYear}
                    onPress={() => updateArchiveFilters(year, activeTag)}
                  >
                    {year}
                  </Button>
                ))}
              </div>
            </CardBody>
          </Card>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center rounded-[2rem] border border-dashed border-black/10 bg-white/50">
              <Spinner color="warning" label="正在加载归档文章" labelColor="warning" />
            </div>
          ) : null}

          {!loading && error ? (
            <Card className="border border-danger/30 bg-danger-50">
              <CardBody className="p-6 text-sm text-danger-700">无法加载归档列表：{error}</CardBody>
            </Card>
          ) : null}

          {!loading && !error && archiveGroups.length === 0 ? (
            <Card className="glass-panel border border-black/10">
              <CardBody className="p-6 text-sm leading-7 text-[var(--muted)]">
                当前筛选下还没有记录，可以换一个年份、标签，或者回到全部归档看看。
              </CardBody>
            </Card>
          ) : null}

          {!loading && !error ? (
            <div className="space-y-5">
              {archiveGroups.map((group) => (
                <Card
                  key={group.key}
                  className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]"
                >
                  <CardHeader className="flex items-center justify-between gap-3 px-5 pb-0 pt-5">
                    <div>
                      <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Monthly Archive</p>
                      <h3 className="display-type mt-2 text-3xl text-[var(--ink)]">{group.label}</h3>
                    </div>
                    <Chip variant="flat" color="warning">
                      {group.posts.length} 篇
                    </Chip>
                  </CardHeader>
                  <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm">
                    {group.posts.map((post) => {
                      const visibleTags = normalizeTags(post.tags);

                      return (
                        <Link
                          key={post.slug}
                          to={`/posts/${post.slug}`}
                          className="rounded-[1.2rem] border border-black/10 bg-white/70 px-4 py-3 leading-7 text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                        >
                          <span className="block font-medium">{renderHighlightedText(post.title, activeKeyword)}</span>
                          <span className="mt-1 block text-[var(--muted)]">
                            {formatPublishDate(post.publishedAt)} · {post.category} · {post.readMinutes} 分钟阅读
                          </span>
                          <span className="mt-2 block text-[var(--muted)]">{renderHighlightedText(post.summary, activeKeyword)}</span>
                          {post.searchSnippet ? (
                            <span className="mt-3 block rounded-[1rem] border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs leading-6 text-amber-900">
                              <span className="flex flex-wrap items-center gap-2">
                                <Chip size="sm" variant="bordered">匹配于 {post.searchSnippet.label}</Chip>
                                {post.searchMode ? <Chip size="sm" variant="bordered">{post.searchMode === "text" ? "全文" : "模糊"}</Chip> : null}
                                {formatSearchScore(post.searchScore) ? <Chip size="sm" color="warning" variant="flat">相关度 {formatSearchScore(post.searchScore) ?? ""}</Chip> : null}
                              </span>
                              <span
                                className="mt-2 block [&_mark]:rounded [&_mark]:bg-amber-200 [&_mark]:px-1"
                                dangerouslySetInnerHTML={{ __html: post.searchSnippet.html }}
                              />
                            </span>
                          ) : null}
                          {visibleTags.length > 0 ? (
                            <span className="mt-3 flex flex-wrap gap-2">
                              {visibleTags.map((tag) => (
                                <Chip
                                  key={`${post.slug}-${tag}`}
                                  size="sm"
                                  variant={tag === activeTag ? "flat" : "light"}
                                  color={tag === activeTag ? "secondary" : "default"}
                                >
                                  #{tag}
                                </Chip>
                              ))}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="sidebar-scroll space-y-5 self-start">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Timeline Stats</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">时间线概览</h3>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
              <p>总计 {allSortedPosts.length} 篇记录，当前筛选下可见 {filteredPosts.length} 篇。</p>
              <p>时间跨度覆盖 {years.length - 1 > 0 ? years.length - 1 : 1} 个年份，累计 {tagArchive.length} 个标签。</p>
              <p>当前归档条件：{currentYearLabel} / {currentTagLabel} / {currentKeywordLabel}</p>
              <Link
                to="/"
                className="inline-flex rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                回首页
              </Link>
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Tag Archive</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">标签归档</h3>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
              <p>按标签切换归档视角，和年份筛选一起生效。</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  radius="full"
                  size="sm"
                  variant={activeTag === archiveFilterAll ? "solid" : "bordered"}
                  color={activeTag === archiveFilterAll ? "primary" : "default"}
                  aria-pressed={activeTag === archiveFilterAll}
                  onPress={() => updateArchiveFilters(activeYear, archiveFilterAll, activeKeyword)}
                >
                  <span>全部</span>
                  <span className="text-xs opacity-70">{allSortedPosts.length}</span>
                </Button>
                {tagArchive.map(({ tag, count }) => (
                  <Button
                    key={tag}
                    radius="full"
                    size="sm"
                    variant={tag === activeTag ? "solid" : "bordered"}
                    color={tag === activeTag ? "primary" : "default"}
                    aria-pressed={tag === activeTag}
                    onPress={() => updateArchiveFilters(activeYear, tag, activeKeyword)}
                  >
                    <span>#{tag}</span>
                    <span className="text-xs opacity-70">{count}</span>
                  </Button>
                ))}
              </div>
            </CardBody>
          </Card>
        </aside>
      </section>
    </div>
  );
}
