import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");

  return (
    <div className="page-shell min-h-screen text-[var(--ink)]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[rgba(246,241,232,0.86)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <Link to="/" className="brand-wordmark text-2xl text-[var(--ink)]">
              Wanderlust
            </Link>
            <p className="mt-1 text-sm text-[var(--muted)]">
              编译器、性能与系统工程笔记。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Chip color="warning" variant="flat" className="hidden sm:inline-flex">
              长期更新中
            </Chip>
            <Link
              to="/"
              className={
                isHome
                  ? "rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5"
                  : "rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              }
            >
              文章
            </Link>
            <Link
              to="/archive"
              className={
                isArchive
                  ? "rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5"
                  : "rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70"
              }
            >
              归档
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <Outlet />
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-10 pt-2 text-sm text-[var(--muted)] sm:px-6 lg:px-8">
        <div className="h-px w-full bg-black/10" />
        <p>Wanderlust 记录编译器、性能分析、深度学习工程、构建脚本和 Kubernetes 实践。</p>
      </footer>
    </div>
  );
}