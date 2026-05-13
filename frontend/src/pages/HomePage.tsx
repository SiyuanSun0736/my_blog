import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner } from "../components/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPosts } from "../lib/api";
import type { PostSummary } from "../types";
import { PostCard } from "../components/PostCard";

const POSTS_PER_PAGE = 2;
const GITHUB_PROFILE_URL = "https://github.com/SiyuanSun0736";
const AVATAR_URL = "/profile-avatar.jpg";

export function HomePage() {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeCategory, setActiveCategory] = useState("全部");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    fetchPosts()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setPosts(items);
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

  useEffect(() => {
    setCurrentPage(1);
  }, [keyword, activeCategory]);

  const sortedPosts = [...posts].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  const categories = ["全部", ...new Set(sortedPosts.map((post) => post.category))];
  const normalizedKeyword = keyword.trim().toLowerCase();
  const featuredPost = sortedPosts.find((post) => post.featured) ?? sortedPosts[0];
  const latestPost = sortedPosts[0];
  const filteredPosts = sortedPosts.filter((post) => {
    const matchesCategory = activeCategory === "全部" || post.category === activeCategory;
    const matchesKeyword =
      normalizedKeyword.length === 0 ||
      post.title.toLowerCase().includes(normalizedKeyword) ||
      post.summary.toLowerCase().includes(normalizedKeyword) ||
      post.tags.some((tag) => tag.toLowerCase().includes(normalizedKeyword));

    return matchesCategory && matchesKeyword;
  });
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE));
  const paginatedPosts = filteredPosts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE,
  );
  const categoryCounts = sortedPosts.reduce<Record<string, number>>((counts, post) => {
    counts[post.category] = (counts[post.category] ?? 0) + 1;
    return counts;
  }, {});
  const tagCounts = sortedPosts.reduce<Record<string, number>>((counts, post) => {
    post.tags.forEach((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
    return counts;
  }, {});
  const topTags = Object.entries(tagCounts)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], "zh-CN");
    })
    .slice(0, 6);
  const averageReadMinutes =
    sortedPosts.length > 0
      ? Math.round(
          sortedPosts.reduce((minutes, post) => minutes + post.readMinutes, 0) / sortedPosts.length,
        )
      : 0;
  const archiveGroups = sortedPosts.reduce<Array<{ key: string; label: string; posts: PostSummary[] }>>(
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
  const archivePreviewGroups = archiveGroups.slice(0, 3);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

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

  return (
    <div className="space-y-10 lg:space-y-12">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)]">
        <Card className="overflow-hidden border border-black/10 bg-[var(--panel-strong)] shadow-[0_30px_90px_rgba(77,53,35,0.12)]">
          <div className="h-3 w-full bg-[linear-gradient(90deg,#d96c3d_0%,#0f766e_100%)]" />
          <CardHeader className="flex flex-col items-start gap-4 px-6 pb-0 pt-6 sm:px-8 sm:pt-8">
            <div className="max-w-3xl space-y-4">
              <p className="font-mono text-sm uppercase tracking-[0.28em] text-[var(--muted)]">
                Engineering Log / Compiler / Perf / Deep Learning / Build / Kubernetes
              </p>
              <h1 className="display-type text-4xl leading-none text-[var(--ink)] sm:text-5xl lg:text-6xl">
                WanderlustBlog
              </h1>
              <p className="max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                记录编译器、性能和系统工程里的真实工作流。
              </p>
              <p className="max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                这里主要写编译器实现、perf 火焰图、深度学习训练里的工程细节、automake 和 make 脚本，以及 Kubernetes 上线与排障。
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-6 px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
            <div className="flex flex-wrap gap-3">
              <a
                href={GITHUB_PROFILE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                去 GitHub
              </a>
              <a
                href="#latest-posts"
                className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                进入文章
              </a>
              <Link
                to="/archive"
                className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                翻归档
              </Link>
              {featuredPost ? (
                <Link
                  to={`/posts/${featuredPost.slug}`}
                  className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
                >
                  先读精选
                </Link>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border border-black/10 bg-white/70 shadow-none">
                <CardBody className="gap-2 p-5">
                  <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">最近更新</p>
                  <p className="text-xl font-semibold text-[var(--ink)]">
                    {latestPost ? formatPublishDate(latestPost.publishedAt) : "等待加载"}
                  </p>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    先把最近一次发布放在最上面，方便从最新实验、复盘或修订开始读。
                  </p>
                </CardBody>
              </Card>
              <Card className="border border-black/10 bg-white/70 shadow-none">
                <CardBody className="gap-2 p-5">
                  <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">内容规模</p>
                  <p className="text-3xl font-semibold text-[var(--ink)]">{sortedPosts.length || 0}</p>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    篇记录，拆成 {Object.keys(categoryCounts).length || 0} 个栏目，方便按问题域而不是按时间硬翻。
                  </p>
                </CardBody>
              </Card>
              <Card className="border border-black/10 bg-white/70 shadow-none">
                <CardBody className="gap-2 p-5">
                  <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">阅读节奏</p>
                  <p className="text-3xl font-semibold text-[var(--ink)]">{averageReadMinutes || 0} 分钟</p>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    单篇平均时长，尽量控制在一次完整 review、通勤或 benchmark 复盘里能读完。
                  </p>
                </CardBody>
              </Card>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-6">
          <Card className="glass-panel border border-black/10 shadow-[0_24px_80px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-4 px-6 pb-0 pt-6">
              <p className="font-mono text-sm tracking-[0.18em] text-[var(--muted)]">PROFILE</p>
              <div className="grid w-full gap-5 sm:grid-cols-[144px_minmax(0,1fr)] sm:items-start">
                <div className="aspect-square overflow-hidden rounded-[2rem] border-2 border-black shadow-[8px_8px_0_rgba(36,24,15,0.9)]">
                  <img
                    src={AVATAR_URL}
                    alt="Wanderlust 的头像"
                    className="h-full w-full object-cover object-center"
                  />
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <h2 className="display-type text-3xl text-[var(--ink)] sm:text-4xl">Wanderlust</h2>
                    <p className="text-sm leading-7 text-[var(--muted)]">
                      主要记录编译器、性能分析、深度学习工程和系统维护的相关项目和笔记。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Chip color="secondary" variant="flat">Compiler</Chip>
                    <Chip color="warning" variant="flat">Perf</Chip>
                    <Chip variant="bordered">Deep Learning</Chip>
                    <Chip variant="bordered">Kubernetes</Chip>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardBody className="gap-4 px-6 pb-6 pt-5">
              <div className="rounded-[1.5rem] border border-black/10 bg-white/75 p-5 text-sm leading-7 text-[var(--muted)]">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">GitHub</p>
                <a
                  href={GITHUB_PROFILE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block font-mono text-lg font-semibold text-[var(--ink)] transition hover:opacity-70"
                >
                  github.com/SiyuanSun0736
                </a>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    href={GITHUB_PROFILE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    去 GitHub
                  </a>
                  <Link
                    to="/archive"
                    className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
                  >
                    看时间线
                  </Link>
                </div>
              </div>

              {featuredPost ? (
                <div className="rounded-[1.5rem] border border-black/10 bg-[rgba(15,118,110,0.08)] p-5 text-sm leading-7 text-[var(--muted)]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">先读这篇</p>
                  <Link
                    to={`/posts/${featuredPost.slug}`}
                    className="mt-2 block text-xl font-semibold text-[var(--ink)] transition hover:opacity-70"
                  >
                    {featuredPost.title}
                  </Link>
                  <p className="mt-2">{featuredPost.summary}</p>
                  <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
                    {formatPublishDate(featuredPost.publishedAt)} · {featuredPost.category} · {featuredPost.readMinutes} 分钟阅读
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_24px_80px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-6 pb-0 pt-6">
              <p className="font-mono text-sm tracking-[0.18em] text-[var(--muted)]">FOCUS MAP</p>
              <h2 className="display-type text-3xl text-[var(--ink)]">当前关注</h2>
            </CardHeader>
            <CardBody className="gap-4 px-6 pb-6 pt-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.25rem] border border-black/10 bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">Compiler</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">SSA、IR lowering、pass 顺序与代码生成细节。</p>
                </div>
                <div className="rounded-[1.25rem] border border-black/10 bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">Perf</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">flamegraph、cache 行为、回归定位与 microbenchmark。</p>
                </div>
                <div className="rounded-[1.25rem] border border-black/10 bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">Deep Learning</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">训练流水线、CUDA 资源预算和可恢复的实验流程。</p>
                </div>
                <div className="rounded-[1.25rem] border border-black/10 bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">Build / K8s</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">Makefile、发布脚本、集群排障与运行手册。</p>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-black/10 bg-white/75 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Hot Tags</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {topTags.slice(0, 4).map(([tag, count]) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setKeyword(tag)}
                      className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-sm text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                    >
                      #{tag} · {count}
                    </button>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_320px]">
        <div id="latest-posts" className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">Latest Notes</p>
              <h2 className="display-type text-4xl text-[var(--ink)]">最新记录</h2>
            </div>
            <p className="text-sm text-[var(--muted)]">
              第 {currentPage} / {totalPages} 页 · 共 {filteredPosts.length} 篇
            </p>
          </div>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardBody className="gap-5 p-5 sm:p-6">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--ink)]">关键词搜索</p>
                <Input
                  aria-label="搜索博客文章"
                  placeholder="输入关键词，例如：SSA、perf、CUDA、Makefile、Kubernetes"
                  radius="lg"
                  value={keyword}
                  onValueChange={setKeyword}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--ink)]">主题筛选</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Button
                      key={category}
                      radius="full"
                      size="sm"
                      variant={category === activeCategory ? "solid" : "bordered"}
                      color={category === activeCategory ? "primary" : "default"}
                      onPress={() => setActiveCategory(category)}
                    >
                      {category}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-black/10 bg-[rgba(15,118,110,0.08)] p-4 text-sm leading-7 text-[var(--muted)]">
                先用关键词缩到一个技术面，再按栏目回看，是工程博客里最省时间的找法。
              </div>
            </CardBody>
          </Card>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center rounded-[2rem] border border-dashed border-black/10 bg-white/50">
              <Spinner color="warning" label="正在加载博客文章" labelColor="warning" />
            </div>
          ) : null}

          {!loading && error ? (
            <Card className="border border-danger/30 bg-danger-50">
              <CardBody className="p-6 text-sm text-danger-700">
                无法加载文章列表：{error}
              </CardBody>
            </Card>
          ) : null}

          {!loading && !error ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {paginatedPosts.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          ) : null}

          {!loading && !error && filteredPosts.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-[1.75rem] border border-black/10 bg-white/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-7 text-[var(--muted)]">
                当前命中 {filteredPosts.length} 篇文章，覆盖 {Object.keys(categoryCounts).length || 0} 个主题入口。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  radius="full"
                  size="sm"
                  variant="bordered"
                  isDisabled={currentPage === 1}
                  onPress={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  上一页
                </Button>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <Button
                    key={page}
                    radius="full"
                    size="sm"
                    variant={page === currentPage ? "solid" : "bordered"}
                    color={page === currentPage ? "primary" : "default"}
                    onPress={() => setCurrentPage(page)}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  radius="full"
                  size="sm"
                  variant="bordered"
                  isDisabled={currentPage === totalPages}
                  onPress={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          ) : null}

          {!loading && !error && filteredPosts.length === 0 ? (
            <Card className="glass-panel border border-black/10">
              <CardBody className="p-6 text-sm leading-7 text-[var(--muted)]">
                没有匹配的文章。试试换成更短的关键词，比如 perf、编译器、Kubernetes或训练。
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-5">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Columns</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">栏目入口</h3>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4">
              {categories
                .filter((category) => category !== "全部")
                .map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={
                      activeCategory === category
                        ? "flex w-full items-center justify-between rounded-[1.2rem] border border-transparent bg-[var(--ink)] px-4 py-3 text-left text-sm text-white transition"
                        : "flex w-full items-center justify-between rounded-[1.2rem] border border-black/10 bg-white/70 px-4 py-3 text-left text-sm text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                    }
                  >
                    <span>{category}</span>
                    <span>{categoryCounts[category] ?? 0} 篇</span>
                  </button>
                ))}
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">High-Signal Tags</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">高频标签</h3>
            </CardHeader>
            <CardBody className="gap-4 px-5 pb-5 pt-4">
              <div className="flex flex-wrap gap-2">
                {topTags.map(([tag, count]) => (
                  <Button
                    key={tag}
                    radius="full"
                    size="sm"
                    variant="bordered"
                    onPress={() => setKeyword(tag)}
                  >
                    #{tag} · {count}
                  </Button>
                ))}
              </div>

              {(keyword || activeCategory !== "全部") && (
                <Button
                  radius="full"
                  size="sm"
                  variant="light"
                  color="warning"
                  onPress={() => {
                    setKeyword("");
                    setActiveCategory("全部");
                  }}
                >
                  清空筛选
                </Button>
              )}
            </CardBody>
          </Card>

          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Start Here</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">先看这些</h3>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm">
              {sortedPosts.slice(0, 3).map((post) => (
                <Link
                  key={post.slug}
                  to={`/posts/${post.slug}`}
                  className="rounded-[1.2rem] border border-black/10 bg-white/70 px-4 py-3 leading-7 text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                >
                  <span className="block font-medium">{post.title}</span>
                  <span className="mt-1 block text-[var(--muted)]">
                    {formatPublishDate(post.publishedAt)} · {post.readMinutes} 分钟阅读
                  </span>
                </Link>
              ))}
            </CardBody>
          </Card>

        </aside>
      </section>

      <section id="archive" className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">Recent Timeline</p>
            <h2 className="display-type text-4xl text-[var(--ink)]">近期归档</h2>
          </div>
          <Link
            to="/archive"
            className="inline-flex rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
          >
            打开完整时间线
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {archivePreviewGroups.map((group) => (
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
                {group.posts.map((post) => (
                  <Link
                    key={post.slug}
                    to={`/posts/${post.slug}`}
                    className="rounded-[1.2rem] border border-black/10 bg-white/70 px-4 py-3 leading-7 text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                  >
                    <span className="block font-medium">{post.title}</span>
                    <span className="mt-1 block text-[var(--muted)]">
                      {formatPublishDate(post.publishedAt)} · {post.category}
                    </span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}