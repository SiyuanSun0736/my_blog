import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");

  return (
    <div className="page-shell text-[var(--ink)]">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[rgba(246,241,232,0.86)] backdrop-blur-xl">
        <div className="page-frame flex flex-col gap-4 py-4 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <Link to="/" className="brand-wordmark text-2xl text-[var(--ink)]">
              Wanderlust
            </Link>
            <p className="mt-1 max-w-[34rem] text-sm leading-6 text-[var(--muted)]">
              编译器、性能与系统工程笔记。
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:justify-end">
            <Chip color="warning" variant="flat" className="hidden sm:inline-flex">
              长期更新中
            </Chip>
            <Link
              to="/"
              className={
                isHome
                  ? "inline-flex flex-1 justify-center rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 sm:flex-none sm:px-5"
                  : "inline-flex flex-1 justify-center rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:flex-none sm:px-5"
              }
            >
              文章
            </Link>
            <Link
              to="/archive"
              className={
                isArchive
                  ? "inline-flex flex-1 justify-center rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 sm:flex-none sm:px-5"
                  : "inline-flex flex-1 justify-center rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:flex-none sm:px-5"
              }
            >
              归档
            </Link>
          </div>
        </div>
      </header>

      <main className="page-frame py-6 sm:py-8 lg:py-10 xl:py-12">
        <Outlet />
      </main>

      <footer className="page-frame flex flex-col gap-3 pb-8 pt-2 text-sm text-[var(--muted)] sm:pb-10">
        <div className="h-px w-full bg-black/10" />
        <p>Wanderlust 记录编译器、性能分析、深度学习工程、构建脚本和 Kubernetes 实践。</p>
      </footer>
    </div>
  );
}