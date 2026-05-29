"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Atom, FlaskConical, Menu, Microscope, Sparkles, X } from "lucide-react";
import { useStudioMode, type StudioActiveMode } from "@/context/StudioModeContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeMode, setActiveMode } = useStudioMode();
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);

  const goExplore = useCallback(
    (mode: StudioActiveMode) => {
      setActiveMode(mode);
      closeMobileNav();
      if (pathname !== "/explore") {
        router.push("/explore");
      }
    },
    [setActiveMode, closeMobileNav, pathname, router],
  );

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    if (!isMobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileNavOpen]);

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 py-4"
    >
      <div className="max-w-7xl mx-auto relative">
        {/* ── Top bar ── */}
        <div className="flex items-center justify-between gap-2 md:gap-3 glass px-3 md:px-6 py-3 rounded-full">
          <div className="flex items-center gap-2 min-w-0 flex-1 md:flex-none">
            <Link
              href="/"
              onClick={closeMobileNav}
              className="flex items-center gap-2 group flex-shrink-0 min-w-0"
            >
              <Atom className="w-6 h-6 text-indigo-400 group-hover:text-purple-400 transition-colors flex-shrink-0" />
              <span
                className={cn(
                  "font-semibold tracking-wide text-sm md:text-base transition-colors truncate",
                  ui.nav.brand,
                )}
              >
                Molecule<span className={ui.nav.brandMuted}>Studio</span>
              </span>
            </Link>
          </div>

          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium flex-1 justify-center min-w-0">
            <NavLinks
              pathname={pathname}
              activeMode={activeMode}
              ui={ui}
              t={t}
              onExplore={() => goExplore("explorer")}
            />

            <div
              className={cn("flex items-center gap-1.5 pl-4 ml-1 border-l", ui.nav.divider)}
              role="tablist"
              aria-label={t.aria_molecules_reactions}
            >
              <ModeTab
                active={pathname === "/explore" && activeMode === "explorer"}
                icon={<Microscope className="w-3.5 h-3.5" />}
                label={t.tab_molecules}
                onClick={() => goExplore("explorer")}
              />
              <ModeTab
                active={pathname === "/explore" && activeMode === "reaction"}
                icon={<FlaskConical className="w-3.5 h-3.5" />}
                label={t.tab_reactions}
                onClick={() => goExplore("reaction")}
              />
            </div>

            <ThemeToggle />
            <LanguageSelector />
          </nav>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/explore"
              onClick={() => goExplore("explorer")}
              className={cn(
                "hidden lg:inline-flex px-4 lg:px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 border",
                ui.nav.cta,
              )}
            >
              {t.button_start_exploring}
            </Link>

            {/* Mobile main nav hamburger */}
            <button
              type="button"
              onClick={() => setIsMobileNavOpen((open) => !open)}
              className={cn(
                "md:hidden flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 active:scale-95",
                isWhiteLab
                  ? "border-slate-300 bg-white text-neutral-800 [@media(hover:hover)]:hover:bg-slate-100"
                  : "border-white/15 bg-white/5 text-gray-200 [@media(hover:hover)]:hover:bg-white/10",
                isMobileNavOpen &&
                  (isWhiteLab ? "bg-slate-100 border-slate-400" : "bg-white/10 border-white/25"),
              )}
              aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMobileNavOpen}
              aria-controls="mobile-nav-panel"
            >
              {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* ── Mobile dropdown ── */}
        <AnimatePresence>
          {isMobileNavOpen && (
            <>
              <motion.button
                type="button"
                aria-label="Close menu"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="md:hidden fixed inset-0 top-[4.5rem] z-40 bg-black/40 backdrop-blur-[2px]"
                onClick={closeMobileNav}
              />
              <motion.div
                id="mobile-nav-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Main navigation"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "md:hidden absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl border shadow-2xl overflow-hidden",
                  "transition-all duration-300",
                  isWhiteLab
                    ? "bg-white border-slate-200 shadow-slate-200/40"
                    : "bg-neutral-950/98 border-white/10 shadow-black/50 backdrop-blur-xl",
                )}
              >
                <nav className="flex flex-col p-4 max-h-[min(75vh,32rem)] overflow-y-auto scrollbar-thin">
                  <MobileNavLink
                    href="/ai-lab"
                    active={pathname === "/ai-lab"}
                    onClick={closeMobileNav}
                    icon={<Sparkles className="w-4 h-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_ai_lab ?? "AI Lab"}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/explore"
                    active={pathname === "/explore" && activeMode === "explorer"}
                    onClick={() => goExplore("explorer")}
                    ui={ui}
                  >
                    {t.nav_explore}
                  </MobileNavLink>
                  <MobileNavLink href="/learn" active={pathname === "/learn"} onClick={closeMobileNav} ui={ui}>
                    {t.nav_learn}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/showcase"
                    active={pathname === "/showcase"}
                    onClick={closeMobileNav}
                    ui={ui}
                  >
                    {t.nav_showcase}
                  </MobileNavLink>

                  <div className={cn("my-3 h-px", ui.nav.divider, "bg-current opacity-20")} />

                  <p className={cn("text-[10px] uppercase tracking-widest px-3 mb-2", ui.typography.muted)}>
                    {t.aria_molecules_reactions}
                  </p>
                  <div className="flex flex-col gap-2 px-1">
                    <ModeTab
                      active={pathname === "/explore" && activeMode === "explorer"}
                      icon={<Microscope className="w-4 h-4" />}
                      label={t.tab_molecules}
                      onClick={() => goExplore("explorer")}
                      fullWidth
                    />
                    <ModeTab
                      active={pathname === "/explore" && activeMode === "reaction"}
                      icon={<FlaskConical className="w-4 h-4" />}
                      label={t.tab_reactions}
                      onClick={() => goExplore("reaction")}
                      fullWidth
                    />
                  </div>

                  <div className={cn("my-3 h-px", ui.nav.divider, "bg-current opacity-20")} />

                  <div className="flex flex-col gap-3 px-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium", ui.typography.muted)}>Theme</span>
                      <ThemeToggle />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium", ui.typography.muted)}>Language</span>
                      <LanguageSelector />
                    </div>
                  </div>

                  <Link
                    href="/explore"
                    onClick={() => goExplore("explorer")}
                    className={cn(
                      "mt-4 mx-1 py-3 rounded-xl text-sm font-semibold text-center transition-all duration-300 border",
                      ui.nav.cta,
                    )}
                  >
                    {t.button_start_exploring}
                  </Link>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}

function NavLinks({
  pathname,
  activeMode,
  ui,
  t,
  onExplore,
}: {
  pathname: string;
  activeMode: StudioActiveMode;
  ui: ReturnType<typeof useTheme>["ui"];
  t: ReturnType<typeof useLanguage>["t"];
  onExplore: () => void;
}) {
  return (
    <>
      <Link
        href="/ai-lab"
        className={cn(
          "transition-colors flex items-center gap-1.5",
          pathname === "/ai-lab" ? ui.nav.linkActive : cn(ui.nav.link, "[@media(hover:hover)]:hover:text-glow"),
        )}
      >
        <Sparkles className="w-3.5 h-3.5 opacity-80" />
        {t.nav_ai_lab ?? "AI Lab"}
      </Link>
      <Link
        href="/explore"
        onClick={onExplore}
        className={cn(
          "transition-colors",
          pathname === "/explore" && activeMode === "explorer"
            ? ui.nav.linkActive
            : cn(ui.nav.link, "[@media(hover:hover)]:hover:text-glow"),
        )}
      >
        {t.nav_explore}
      </Link>
      <Link
        href="/learn"
        className={cn(ui.nav.link, "transition-colors [@media(hover:hover)]:hover:text-glow")}
      >
        {t.nav_learn}
      </Link>
      <Link
        href="/showcase"
        className={cn(ui.nav.link, "transition-colors [@media(hover:hover)]:hover:text-glow")}
      >
        {t.nav_showcase}
      </Link>
    </>
  );
}

function MobileNavLink({
  href,
  active,
  onClick,
  children,
  icon,
  ui,
}: {
  href: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  ui: ReturnType<typeof useTheme>["ui"];
}) {
  const { isWhiteLab } = useTheme();

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200 active:scale-[0.99]",
        active
          ? cn(ui.nav.linkActive, isWhiteLab ? "bg-slate-100" : "bg-white/5")
          : cn(ui.nav.link, "active:opacity-80"),
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function ModeTab({
  active,
  label,
  icon,
  compact,
  fullWidth,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  compact?: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  const { ui } = useTheme();

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-xl font-semibold transition-all duration-300 flex items-center gap-2",
        fullWidth ? "w-full justify-start px-3 py-3 text-sm" : "rounded-full",
        compact ? "px-3 py-1.5 text-[11px]" : !fullWidth && "px-3.5 py-1.5 text-xs",
        active ? ui.nav.modeTabActive : ui.nav.modeTabIdle,
      )}
    >
      <span className="opacity-95">{icon}</span>
      {!compact && <span>{label}</span>}
    </button>
  );
}
