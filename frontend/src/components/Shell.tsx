import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

type ThemeMode = "solid" | "liquid-glass";

const THEME_STORAGE_KEY = "wanderlust-theme";

function resolveStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "solid";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "liquid-glass" ? "liquid-glass" : "solid";
}

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 360);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    let stableScrollTop = window.scrollY;
    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;
    let isResizing = false;
    let resizeFrame: number | null = null;
    let releaseTimer: number | null = null;

    const getScroller = () => document.scrollingElement ?? document.documentElement;

    const restoreScrollTop = () => {
      const scroller = getScroller();
      const maxScrollTop = Math.max(0, scroller.scrollHeight - window.innerHeight);
      const nextScrollTop = Math.min(stableScrollTop, maxScrollTop);

      if (Math.abs(window.scrollY - nextScrollTop) <= 1) {
        return;
      }

      window.scrollTo({ top: nextScrollTop, left: window.scrollX, behavior: "auto" });
      scroller.scrollTop = nextScrollTop;
    };

    const handleStableScroll = () => {
      if (isResizing || window.innerWidth !== viewportWidth || window.innerHeight !== viewportHeight) {
        return;
      }

      stableScrollTop = window.scrollY;
    };

    const handleResize = () => {
      isResizing = true;
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;

      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        restoreScrollTop();
      });

      if (releaseTimer !== null) {
        window.clearTimeout(releaseTimer);
      }

      releaseTimer = window.setTimeout(() => {
        restoreScrollTop();
        isResizing = false;
        stableScrollTop = window.scrollY;
      }, 180);
    };

    window.addEventListener("scroll", handleStableScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }

      if (releaseTimer !== null) {
        window.clearTimeout(releaseTimer);
      }

      window.removeEventListener("scroll", handleStableScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="page-shell text-[var(--ink)]">
      <header className="site-header border-b border-black/10">
        <div className="page-frame flex flex-col gap-4 py-4 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <Link to="/" className="brand-card liquid-glass-card">
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold leading-6 text-[var(--ink)]">
                Wanderlust
              </span>
              <span className="block truncate text-sm leading-5 text-[var(--muted)]">
                工程日志作者
              </span>
            </span>
          </Link>

          <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:justify-end">
            <Chip color="warning" variant="flat" className="hidden sm:inline-flex">
              长期更新中
            </Chip>
            <div
              className="theme-switch liquid-glass-control"
              aria-label="主题选项"
              role="radiogroup"
            >
              <span className={`theme-switch-thumb ${themeMode === "liquid-glass" ? "translate-x-full" : "translate-x-0"}`} />
              <button
                type="button"
                role="radio"
                aria-checked={themeMode === "solid"}
                className="theme-switch-option"
                onClick={() => setThemeMode("solid")}
              >
                纯色
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={themeMode === "liquid-glass"}
                className="theme-switch-option"
                onClick={() => setThemeMode("liquid-glass")}
              >
                玻璃
              </button>
            </div>
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

      <button
        type="button"
        aria-label="回到顶部"
        title="回到顶部"
        onClick={scrollToTop}
        className={`fixed bottom-5 right-5 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/10 bg-[rgba(255,251,245,0.88)] text-2xl font-semibold leading-none text-[var(--ink)] shadow-[0_14px_36px_rgba(36,24,15,0.18)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-black/20 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(15,118,110,0.5)] sm:bottom-7 sm:right-7 ${
          showBackToTop ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        ↑
      </button>
    </div>
  );
}
