import { Button, Card, CardBody, CardHeader, Chip, Spinner } from "../components/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPosts } from "../lib/api";
import type { PostSummary } from "../types";

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

export function ArchivePage() {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeYear, setActiveYear] = useState("全部");

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

  const sortedPosts = [...posts].sort(
    (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
  const years = [
    "全部",
    ...new Set(sortedPosts.map((post) => String(new Date(post.publishedAt).getFullYear()))),
  ];
  const filteredPosts = sortedPosts.filter((post) => {
    if (activeYear === "全部") {
      return true;
    }

    return String(new Date(post.publishedAt).getFullYear()) === activeYear;
  });
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
            <p className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">按年份筛选 / 按月份折叠</p>
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
                  <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Year Filter</p>
                  <h2 className="display-type text-4xl text-[var(--ink)]">年份筛选</h2>
                </div>
                <p className="text-sm text-[var(--muted)]">当前查看 {activeYear === "全部" ? "全部年份" : `${activeYear} 年`}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {years.map((year) => (
                  <Button
                    key={year}
                    radius="full"
                    size="sm"
                    variant={year === activeYear ? "solid" : "bordered"}
                    color={year === activeYear ? "primary" : "default"}
                    onPress={() => setActiveYear(year)}
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
                当前筛选下还没有记录，可以换一个年份，或者回到全部年份看看。
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
                    {group.posts.map((post) => (
                      <Link
                        key={post.slug}
                        to={`/posts/${post.slug}`}
                        className="rounded-[1.2rem] border border-black/10 bg-white/70 px-4 py-3 leading-7 text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30"
                      >
                        <span className="block font-medium">{post.title}</span>
                        <span className="mt-1 block text-[var(--muted)]">
                          {formatPublishDate(post.publishedAt)} · {post.category} · {post.readMinutes} 分钟阅读
                        </span>
                        <span className="mt-2 block text-[var(--muted)]">{post.summary}</span>
                      </Link>
                    ))}
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="space-y-5">
          <Card className="glass-panel border border-black/10 shadow-[0_18px_60px_rgba(75,54,34,0.08)]">
            <CardHeader className="flex flex-col items-start gap-2 px-5 pb-0 pt-5">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Timeline Stats</p>
              <h3 className="display-type text-3xl text-[var(--ink)]">时间线概览</h3>
            </CardHeader>
            <CardBody className="gap-3 px-5 pb-5 pt-4 text-sm leading-7 text-[var(--muted)]">
              <p>总计 {sortedPosts.length} 篇记录，当前年份下可见 {filteredPosts.length} 篇。</p>
              <p>时间跨度覆盖 {years.length - 1 > 0 ? years.length - 1 : 1} 个年份</p>
              <Link
                to="/"
                className="inline-flex rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              >
                回首页
              </Link>
            </CardBody>
          </Card>

        </aside>
      </section>
    </div>
  );
}