import { Chip } from "./ui";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type ThemeMode = "solid" | "frosted-glass";
type SolidPaletteMode = "light" | "dark";
type GlassColorMode = "color" | "white";

const THEME_STORAGE_KEY = "wanderlust-theme";
const SOLID_PALETTE_STORAGE_KEY = "wanderlust-solid-palette";
const GLASS_WALLPAPER_STORAGE_KEY = "wanderlust-glass-wallpaper";
const GLASS_HUE_STORAGE_KEY = "wanderlust-glass-hue";
const GLASS_COLOR_MODE_STORAGE_KEY = "wanderlust-glass-color-mode";

const DEFAULT_SOLID_HUE = 32;
const DEFAULT_GLASS_HUE = 105;
const GLASS_MENU_WIDTH = 336;

const WALLPAPERS = [
  { label: "壁纸 1", value: "07905b16e08767c9cc4719f0266b004b", ambience: "148 200 77" },
  { label: "壁纸 2", value: "4bdca906a520689e14a45007951472b6", ambience: "143 208 220" },
  { label: "壁纸 3", value: "7d47b283a1c99e02de58af14a5032f4f", ambience: "199 174 232" },
  { label: "壁纸 4", value: "9eb477638edf0a072a3ff4bdf9734880", ambience: "245 184 203" },
  { label: "壁纸 5", value: "d4fcc05bd8205c41fbe4f2645bf0c6b8", ambience: "87 143 224" },
];

function resolveStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "solid";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "frosted-glass" || storedTheme === "liquid-glass" ? "frosted-glass" : "solid";
}

function resolveStoredSolidPalette(): SolidPaletteMode {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.localStorage.getItem(SOLID_PALETTE_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function resolveStoredWallpaper() {
  if (typeof window === "undefined") {
    return WALLPAPERS[0].value;
  }

  const storedWallpaper = window.localStorage.getItem(GLASS_WALLPAPER_STORAGE_KEY);
  const normalizedWallpaper = storedWallpaper?.replace(/\.(jpg|jpeg|webp|png)$/i, "");
  if (normalizedWallpaper && WALLPAPERS.some((wallpaper) => wallpaper.value === normalizedWallpaper)) {
    return normalizedWallpaper;
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

function resolveStoredGlassColorMode(): GlassColorMode {
  if (typeof window === "undefined") {
    return "color";
  }

  return window.localStorage.getItem(GLASS_COLOR_MODE_STORAGE_KEY) === "white" ? "white" : "color";
}

export function Shell() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isArchive = location.pathname.startsWith("/archive");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveStoredTheme);
  const [solidPalette, setSolidPalette] = useState<SolidPaletteMode>(resolveStoredSolidPalette);
  const [glassWallpaper, setGlassWallpaper] = useState(resolveStoredWallpaper);
  const [glassHue, setGlassHue] = useState(resolveStoredHue);
  const [glassColorMode, setGlassColorMode] = useState<GlassColorMode>(resolveStoredGlassColorMode);
  const [glassMenuOpen, setGlassMenuOpen] = useState(false);
  const [glassMenuPosition, setGlassMenuPosition] = useState({ top: 0, left: 0 });

  const themeSwitchRef = useRef<HTMLDivElement>(null);
  const solidButtonRef = useRef<HTMLButtonElement>(null);
  const frostedButtonRef = useRef<HTMLButtonElement>(null);
  const glassMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode === "solid" ? "solid" : "liquid-glass";
    document.documentElement.dataset.glassRender = "frosted";
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.solidPalette = solidPalette;
    window.localStorage.setItem(SOLID_PALETTE_STORAGE_KEY, solidPalette);
  }, [solidPalette]);

  useEffect(() => {
    const wallpaper = WALLPAPERS.find((item) => item.value === glassWallpaper) ?? WALLPAPERS[0];
    document.documentElement.style.setProperty("--glass-wallpaper-image", `url("/wallpaper/optimized/${glassWallpaper}.webp")`);
    document.documentElement.style.setProperty("--glass-ambient-rgb", wallpaper.ambience);
    window.localStorage.setItem(GLASS_WALLPAPER_STORAGE_KEY, glassWallpaper);
  }, [glassWallpaper]);

  useEffect(() => {
    document.documentElement.style.setProperty("--dopamine-hue", String(themeMode === "solid" ? DEFAULT_SOLID_HUE : glassHue));
    window.localStorage.setItem(GLASS_HUE_STORAGE_KEY, String(glassHue));
  }, [glassHue, themeMode]);

  useEffect(() => {
    document.documentElement.dataset.glassColor = glassColorMode;
    window.localStorage.setItem(GLASS_COLOR_MODE_STORAGE_KEY, glassColorMode);
  }, [glassColorMode]);

  useEffect(() => {
    if (!glassMenuOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const activeButton = themeMode === "solid" ? solidButtonRef.current : frostedButtonRef.current;
      const buttonRect = activeButton?.getBoundingClientRect();
      if (!buttonRect) {
        return;
      }

      const viewportPadding = 16;
      const menuWidth = Math.min(GLASS_MENU_WIDTH, window.innerWidth - viewportPadding * 2);
      const centeredLeft = buttonRect.left + buttonRect.width / 2 - menuWidth / 2;
      const left = Math.min(window.innerWidth - viewportPadding - menuWidth, Math.max(viewportPadding, centeredLeft));

      setGlassMenuPosition({
        top: Math.round(buttonRect.bottom + 4),
        left: Math.round(left),
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!themeSwitchRef.current?.contains(target) && !glassMenuRef.current?.contains(target)) {
        setGlassMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGlassMenuOpen(false);
      }
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [glassMenuOpen, themeMode]);

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

  const positionGlassMenu = (targetButton?: HTMLButtonElement | null) => {
    const activeButton = targetButton ?? (themeMode === "solid" ? solidButtonRef.current : frostedButtonRef.current);
    const buttonRect = activeButton?.getBoundingClientRect();
    if (!buttonRect) {
      return;
    }

    const viewportPadding = 16;
    const menuWidth = Math.min(GLASS_MENU_WIDTH, window.innerWidth - viewportPadding * 2);
    const centeredLeft = buttonRect.left + buttonRect.width / 2 - menuWidth / 2;
    const left = Math.min(window.innerWidth - viewportPadding - menuWidth, Math.max(viewportPadding, centeredLeft));

    setGlassMenuPosition({
      top: Math.round(buttonRect.bottom + 4),
      left: Math.round(left),
    });
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
            <div className="theme-switch-wrap" ref={themeSwitchRef}>
              <div
                className="theme-switch liquid-glass-control"
                style={{ flex: "0 0 8.5rem", minWidth: "8.5rem", width: "8.5rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                aria-label="主题选项"
                role="radiogroup"
              >
                <span
                  className="theme-switch-thumb"
                  style={{
                    width: "calc(50% - 0.5rem)",
                    left: themeMode === "frosted-glass" ? "calc(50% + 0.25rem)" : "0.25rem",
                  }}
                />
                <button
                  ref={solidButtonRef}
                  type="button"
                  role="radio"
                  aria-checked={themeMode === "solid"}
                  aria-expanded={themeMode === "solid" && glassMenuOpen}
                  className="theme-switch-option theme-switch-glass-option"
                  onClick={() => {
                    setThemeMode("solid");
                    positionGlassMenu(solidButtonRef.current);
                    setGlassMenuOpen((open) => (themeMode === "solid" ? !open : true));
                  }}
                >
                  纯色
                </button>
                <button
                  ref={frostedButtonRef}
                  type="button"
                  role="radio"
                  aria-checked={themeMode === "frosted-glass"}
                  aria-expanded={themeMode === "frosted-glass" && glassMenuOpen}
                  className="theme-switch-option theme-switch-glass-option"
                  onClick={() => {
                    setThemeMode("frosted-glass");
                    positionGlassMenu(frostedButtonRef.current);
                    setGlassMenuOpen((open) => (themeMode === "frosted-glass" ? !open : true));
                  }}
                >
                  毛玻璃
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

      {glassMenuOpen ? (
        <div
          ref={glassMenuRef}
          className={`glass-theme-popover ${themeMode === "solid" ? "solid-theme-popover" : "liquid-glass-card"}`}
          style={
            {
              "--glass-menu-top": `${glassMenuPosition.top}px`,
              "--glass-menu-left": `${glassMenuPosition.left}px`,
            } as CSSProperties
          }
        >
          {themeMode === "solid" ? (
            <div className="glass-theme-section">
              <div className="glass-theme-section-title">
                <span>纯色配色</span>
                <strong>{solidPalette === "dark" ? "深色" : "浅色"}</strong>
              </div>
              <div className="solid-palette-grid" aria-label="纯色配色">
                <button
                  type="button"
                  className="glass-effect-option"
                  data-active={solidPalette === "light"}
                  onClick={() => setSolidPalette("light")}
                >
                  当前（浅色）
                </button>
                <button
                  type="button"
                  className="glass-effect-option"
                  data-active={solidPalette === "dark"}
                  onClick={() => setSolidPalette("dark")}
                >
                  深色
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="glass-theme-section">
                <div className="glass-theme-section-title">
                  <span>背景壁纸</span>
                  <strong>{WALLPAPERS.find((wallpaper) => wallpaper.value === glassWallpaper)?.label ?? "壁纸"}</strong>
                </div>
                <div className="wallpaper-grid" role="listbox" aria-label="背景壁纸">
                  {WALLPAPERS.map((wallpaper) => (
                    <button
                      key={wallpaper.value}
                      type="button"
                      className="wallpaper-option"
                      data-active={glassWallpaper === wallpaper.value}
                      onClick={() => setGlassWallpaper(wallpaper.value)}
                    >
                      <img src={`/wallpaper/thumbs/${wallpaper.value}.webp`} alt="" loading="lazy" decoding="async" />
                      <span>{wallpaper.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="glass-hue-control glass-theme-section">
                <span className="glass-theme-section-title">
                  <span>主题色相</span>
                  <strong>{glassColorMode === "white" ? "白色" : glassHue}</strong>
                </span>
                <div className="glass-color-mode-row">
                  <button
                    type="button"
                    className="glass-color-mode-option"
                    data-active={glassColorMode === "white"}
                    onClick={() => setGlassColorMode((mode) => (mode === "white" ? "color" : "white"))}
                  >
                    白色
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="330"
                  step="15"
                  value={glassHue}
                  onChange={(event) => {
                    setGlassColorMode("color");
                    setGlassHue(Number(event.target.value));
                  }}
                />
              </label>
            </>
          )}
        </div>
      ) : null}

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
