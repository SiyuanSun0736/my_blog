import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

type ThemeMode = "solid" | "liquid-glass";

const THEME_STORAGE_KEY = "wanderlust-theme";
const GLASS_WALLPAPER_STORAGE_KEY = "wanderlust-glass-wallpaper";
const GLASS_HUE_STORAGE_KEY = "wanderlust-glass-hue";
const DEFAULT_GLASS_HUE = 105;
const WALLPAPERS = [
  { label: "壁纸 1", value: "07905b16e08767c9cc4719f0266b004b.jpg" },
  { label: "壁纸 2", value: "4bdca906a520689e14a45007951472b6.jpg" },
  { label: "壁纸 3", value: "7d47b283a1c99e02de58af14a5032f4f.jpg" },
  { label: "壁纸 4", value: "9eb477638edf0a072a3ff4bdf9734880.jpg" },
  { label: "壁纸 5", value: "d4fcc05bd8205c41fbe4f2645bf0c6b8.jpg" },
];

function resolveStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "solid";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "liquid-glass" ? "liquid-glass" : "solid";
}

function resolveStoredWallpaper() {
  if (typeof window === "undefined") {
    return WALLPAPERS[0].value;
  }

  const storedWallpaper = window.localStorage.getItem(GLASS_WALLPAPER_STORAGE_KEY);
  if (storedWallpaper && WALLPAPERS.some((wallpaper) => wallpaper.value === storedWallpaper)) {
    return storedWallpaper;
  }

  return WALLPAPERS[0].value;
}

function resolveStoredHue() {
  if (typeof window === "undefined") {
    return DEFAULT_GLASS_HUE;
  }

  const storedHue = Number(window.localStorage.getItem(GLASS_HUE_STORAGE_KEY));
  return Number.isFinite(storedHue) ? Math.min(330, Math.max(0, storedHue)) : DEFAULT_GLASS_HUE;
}

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveStoredTheme);
  const [glassWallpaper, setGlassWallpaper] = useState(resolveStoredWallpaper);
  const [glassHue, setGlassHue] = useState(resolveStoredHue);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-wallpaper-image", `url("/wallpaper/${glassWallpaper}")`);
    window.localStorage.setItem(GLASS_WALLPAPER_STORAGE_KEY, glassWallpaper);
  }, [glassWallpaper]);

  useEffect(() => {
    document.documentElement.style.setProperty("--dopamine-hue", String(glassHue));
    window.localStorage.setItem(GLASS_HUE_STORAGE_KEY, String(glassHue));
  }, [glassHue]);

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
            <span className="block truncate text-base font-semibold leading-6 text-[var(--ink)]">首页</span>
          </Link>

          <div className="header-actions flex w-full items-center gap-2 overflow-x-auto sm:gap-3 lg:w-auto lg:justify-end">
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
            {themeMode === "liquid-glass" ? (
              <div className="glass-theme-tools liquid-glass-control" aria-label="玻璃主题设置">
                <label className="glass-wallpaper-select">
                  <span>背景</span>
                  <select
                    value={glassWallpaper}
                    onChange={(event) => setGlassWallpaper(event.target.value)}
                  >
                    {WALLPAPERS.map((wallpaper) => (
                      <option key={wallpaper.value} value={wallpaper.value}>
                        {wallpaper.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="glass-hue-control">
                  <span>主题色相</span>
                  <strong>{glassHue}</strong>
                  <input
                    type="range"
                    min="0"
                    max="330"
                    step="15"
                    value={glassHue}
                    onChange={(event) => setGlassHue(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
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
