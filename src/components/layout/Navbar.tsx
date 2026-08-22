"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Atom,
  History,
  LogOut,
  Menu,
  Sparkles,
  User,
  X,
  Zap,
} from "lucide-react";
import { useStudioMode } from "@/context/StudioModeContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { ResourcesMenu, ResourcesMobileLinks } from "@/components/layout/ResourcesMenu";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import { safeNavigate } from "@/lib/navigation/safe-navigate";

/**
 * Global floating pill navbar — product chrome only.
 * Canvas viewport tools (render modes, studio modes) live in CanvasToolbar.
 */
export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setActiveMode } = useStudioMode();
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const { isAuthenticated, credits, openAuthModal, logout, openBillingModal } = useAuth();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);

  const goExplore = useCallback(() => {
    setActiveMode("explorer");
    closeMobileNav();
    if (pathname !== "/explore") {
      safeNavigate(router, "/explore");
    }
  }, [setActiveMode, closeMobileNav, pathname, router]);

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
      className="fixed inset-x-0 top-0 z-50 px-3 py-3 sm:px-4 sm:py-4"
    >
      <div className="relative mx-auto w-full max-w-6xl">
        <div
          className={cn(
            "glass flex min-h-14 items-center gap-2 rounded-full px-3 py-2 sm:gap-3 sm:px-4 md:px-5",
            /* overflow-visible: language / resources menus must escape the pill */
          )}
        >
          {/* ── Left zone: brand + primary nav ── */}
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 md:gap-5">
            <Link
              href="/"
              onClick={closeMobileNav}
              className="group flex shrink-0 items-center gap-2"
              aria-label="MoleculeStudio home"
            >
              <Atom
                className={cn(
                  "h-6 w-6 shrink-0 transition-opacity group-hover:opacity-90",
                  ui.typography.iconAccent,
                )}
              />
              <span
                className={cn(
                  "hidden font-semibold tracking-wide whitespace-nowrap sm:inline text-sm md:text-base",
                  ui.nav.brand,
                )}
              >
                Molecule<span className={ui.nav.brandMuted}>Studio</span>
              </span>
            </Link>

            <nav
              className="hidden min-w-0 items-center gap-1 lg:flex lg:gap-1.5 xl:gap-3"
              aria-label="Main navigation"
            >
              <PrimaryNavLink href="/ai-lab" active={pathname === "/ai-lab"} ui={ui}>
                <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="truncate">{t.nav_ai_lab ?? "AI Lab"}</span>
              </PrimaryNavLink>
              <PrimaryNavLink
                href="/explore"
                active={pathname === "/explore"}
                ui={ui}
                onClick={goExplore}
              >
                <span className="truncate">{t.nav_explore}</span>
              </PrimaryNavLink>
              <PrimaryNavLink href="/atom-models" active={pathname === "/atom-models"} ui={ui}>
                <History className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="truncate">{t.nav_atom_models ?? "Atom Models"}</span>
              </PrimaryNavLink>
              <ResourcesMenu />
            </nav>
          </div>

          {/* ── Right zone: utilities + account ── */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">
            <div className="hidden items-center gap-2 lg:flex">
              <LanguageSelector />
              <ThemeToggle />
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <AuthNavActions
                isAuthenticated={isAuthenticated}
                credits={credits}
                isWhiteLab={isWhiteLab}
                t={t}
                onLogin={() => openAuthModal("login")}
                onRegister={() => openAuthModal("register")}
                onLogout={logout}
                onBuyCredits={openBillingModal}
                compact
              />
            </div>

            <button
              type="button"
              onClick={() => setIsMobileNavOpen((open) => !open)}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all active:scale-95 lg:hidden",
                isWhiteLab
                  ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-100"
                  : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10",
                isMobileNavOpen &&
                  (isWhiteLab ? "border-slate-400 bg-slate-100" : "border-white/25 bg-white/10"),
              )}
              aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMobileNavOpen}
              aria-controls="mobile-nav-panel"
            >
              {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* ── Mobile / tablet drawer ── */}
        <AnimatePresence>
          {isMobileNavOpen && (
            <>
              <motion.button
                type="button"
                aria-label="Close menu"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 top-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden"
                onClick={closeMobileNav}
              />
              <motion.div
                id="mobile-nav-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Main navigation"
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "absolute inset-x-0 top-full z-50 mt-2 max-h-[min(80vh,36rem)] overflow-hidden rounded-2xl border shadow-2xl lg:hidden",
                  isWhiteLab
                    ? "border-slate-200 bg-white shadow-slate-200/40"
                    : "border-white/10 bg-neutral-950/98 shadow-black/50 backdrop-blur-xl",
                )}
              >
                <nav className="scrollbar-thin flex max-h-[min(80vh,36rem)] flex-col gap-0.5 overflow-y-auto overscroll-contain p-3 sm:p-4">
                  <MobileNavLink
                    href="/ai-lab"
                    active={pathname === "/ai-lab"}
                    onClick={closeMobileNav}
                    icon={<Sparkles className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_ai_lab ?? "AI Lab"}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/explore"
                    active={pathname === "/explore"}
                    onClick={goExplore}
                    ui={ui}
                  >
                    {t.nav_explore}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/atom-models"
                    active={pathname === "/atom-models"}
                    onClick={closeMobileNav}
                    icon={<History className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_atom_models ?? "Atom Models"}
                  </MobileNavLink>

                  <div className={cn("my-2 h-px opacity-20", isWhiteLab ? "bg-slate-400" : "bg-white")} />

                  <ResourcesMobileLinks
                    pathname={pathname}
                    ui={ui}
                    t={t}
                    onNavigate={closeMobileNav}
                  />

                  <div className={cn("my-2 h-px opacity-20", isWhiteLab ? "bg-slate-400" : "bg-white")} />

                  <div className="flex flex-col gap-3 px-1 pb-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium", ui.typography.muted)}>Language</span>
                      <LanguageSelector />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium", ui.typography.muted)}>Theme</span>
                      <ThemeToggle />
                    </div>
                    <AuthNavActions
                      isAuthenticated={isAuthenticated}
                      credits={credits}
                      isWhiteLab={isWhiteLab}
                      t={t}
                      onLogin={() => {
                        openAuthModal("login");
                        closeMobileNav();
                      }}
                      onRegister={() => {
                        openAuthModal("register");
                        closeMobileNav();
                      }}
                      onLogout={() => {
                        logout();
                        closeMobileNav();
                      }}
                      onBuyCredits={() => {
                        openBillingModal();
                        closeMobileNav();
                      }}
                      stacked
                    />
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}

function PrimaryNavLink({
  href,
  active,
  ui,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  ui: ReturnType<typeof useTheme>["ui"];
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors xl:max-w-none",
        active
          ? ui.nav.linkActive
          : cn(ui.nav.link, "[@media(hover:hover)]:hover:text-glow"),
      )}
    >
      {children}
    </Link>
  );
}

function AuthNavActions({
  isAuthenticated,
  credits,
  isWhiteLab,
  t,
  onLogin,
  onRegister,
  onLogout,
  onBuyCredits,
  stacked,
  compact,
}: {
  isAuthenticated: boolean;
  credits: number | null;
  isWhiteLab: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onBuyCredits: () => void;
  stacked?: boolean;
  compact?: boolean;
}) {
  const { ui } = useTheme();

  if (isAuthenticated) {
    return (
      <div
        className={cn(
          "items-center",
          stacked ? "flex w-full flex-col gap-2" : "flex gap-1.5 xl:gap-2",
        )}
      >
        <Link
          href="/profile"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
            compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
            stacked && "w-full justify-center py-2.5",
            isWhiteLab
              ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
              : "border-white/15 bg-white/5 text-gray-200 hover:border-teal-400/40 hover:bg-teal-500/10",
          )}
        >
          <User className="h-3.5 w-3.5 shrink-0" />
          <span className={cn(compact && "hidden xl:inline")}>{t.nav_profile ?? "Profile"}</span>
        </Link>
        <button
          type="button"
          onClick={onBuyCredits}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border text-xs font-semibold tracking-wide transition-all whitespace-nowrap active:scale-[0.98]",
            compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
            stacked && "w-full justify-center py-2.5",
            isWhiteLab
              ? "border-teal-300/80 bg-teal-50 text-teal-900 shadow-sm hover:bg-teal-100/80"
              : "border-teal-400/40 bg-teal-500/10 text-teal-100 shadow-[0_0_18px_rgba(45,212,191,0.28)] hover:bg-teal-500/15",
          )}
        >
          <Zap className={cn("h-3.5 w-3.5 shrink-0", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
          <span>
            {compact ? (credits ?? "—") : `${t.auth_credits_label ?? "Credits"}: ${credits ?? "—"}`}
          </span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
            compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
            stacked && "w-full py-2.5",
            isWhiteLab
              ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
              : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10",
          )}
          aria-label={t.auth_logout ?? "Logout"}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span className={cn(compact && "hidden xl:inline")}>{t.auth_logout ?? "Logout"}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "items-center",
        stacked ? "flex w-full flex-col gap-2" : "flex gap-2",
      )}
    >
      <button
        type="button"
        onClick={onLogin}
        className={cn(
          "rounded-full border text-xs font-medium transition-all whitespace-nowrap",
          "px-3 py-1.5",
          stacked && "w-full py-2.5",
          isWhiteLab
            ? "border-slate-300 text-neutral-700 hover:bg-slate-50"
            : "border-white/15 text-gray-300 hover:bg-white/8 hover:text-white",
        )}
      >
        {t.auth_login_button ?? "Log In"}
      </button>
      <button
        type="button"
        onClick={onRegister}
        className={cn(
          "rounded-full border text-xs font-semibold transition-all whitespace-nowrap",
          "px-3.5 py-1.5",
          stacked && "w-full py-2.5",
          ui.nav.cta,
        )}
      >
        {t.auth_register_button ?? "Sign Up"}
      </button>
    </div>
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
        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all active:scale-[0.99]",
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
