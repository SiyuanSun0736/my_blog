import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

type SolidPaletteMode = "light" | "dark";

const SOLID_PALETTE_STORAGE_KEY = "wanderlust-solid-palette";
const DEFAULT_SOLID_HUE = 32;

function resolveStoredSolidPalette(): SolidPaletteMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.localStorage.getItem(SOLID_PALETTE_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [solidPalette, setSolidPalette] = useState<SolidPaletteMode>(resolveStoredSolidPalette);

  useEffect(() => {
    document.documentElement.dataset.theme = "solid";
    document.documentElement.dataset.solidPalette = solidPalette;
    document.documentElement.style.setProperty("--dopamine-hue", String(DEFAULT_SOLID_HUE));
    window.localStorage.setItem(SOLID_PALETTE_STORAGE_KEY, solidPalette);
  }, [solidPalette]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 360);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="page-shell text-[var(--ink)]">
      <header className="site-header border-b border-black/10">
        <div className="page-frame flex flex-col gap-4 py-4 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
          <Link to="/" className="brand-card">
            <span className="block truncate text-base font-semibold leading-6 text-[var(--ink)]">首页</span>
          </Link>

          <div className="header-actions flex w-full items-center gap-2 overflow-x-auto sm:gap-3 lg:w-auto lg:justify-end">
            <Chip color="warning" variant="flat" className="hidden sm:inline-flex">
              长期更新中
            </Chip>
            <div className="theme-switch-wrap">
              <div
                className="theme-switch"
                style={{ flex: "0 0 8.5rem", minWidth: "8.5rem", width: "8.5rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                aria-label="主题配色"
                role="radiogroup"
              >
                <span
                  className="theme-switch-thumb"
                  style={{
                    width: "calc(50% - 0.5rem)",
                    left: solidPalette === "dark" ? "calc(50% + 0.25rem)" : "0.25rem",
                  }}
                />
                <button
                  type="button"
                  role="radio"
                  aria-checked={solidPalette === "light"}
                  className="theme-switch-option"
                  onClick={() => setSolidPalette("light")}
                >
                  浅色
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={solidPalette === "dark"}
                  className="theme-switch-option"
                  onClick={() => setSolidPalette("dark")}
                >
                  深色
                </button>
              </div>
            </div>
            <Link
              to="/"
              className={
                isHome
                  ? "inline-flex shrink-0 justify-center rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 sm:px-5"
                  : "inline-flex shrink-0 justify-center rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:px-5"
              }
            >
              文章
            </Link>
            <Link
              to="/archive"
              className={
                isArchive
                  ? "inline-flex shrink-0 justify-center rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 sm:px-5"
                  : "inline-flex shrink-0 justify-center rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/70 sm:px-5"
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
