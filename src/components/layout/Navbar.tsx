"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Atom,
  ChevronDown,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Sparkles,
  User,
  X,
  Zap,
  BookOpen,
  Grid3X3,
  Images,
} from "lucide-react";
import { useStudioMode } from "@/context/StudioModeContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { LanguageSelector } from "@/components/layout/LanguageSelector";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import type { AuthUser } from "@/lib/auth/types";

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
  const { isAuthenticated, credits, user, openAuthModal, logout, openBillingModal } = useAuth();
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
      <div className="relative mx-auto w-[92%] max-w-7xl">
        <div
          className={cn(
            "glass flex min-h-14 items-center justify-between gap-3 rounded-full px-3 py-2 sm:gap-4 sm:px-4 md:px-5",
            /* overflow-visible: language / profile menus must escape the pill */
          )}
        >
          {/* ── Left: brand ── */}
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

          {/* ── Center: primary nav ── */}
          <nav
            className="hidden min-w-0 flex-1 items-center justify-center gap-3 lg:flex xl:gap-4"
            aria-label="Main navigation"
          >
            <PrimaryNavLink href="/ai-lab" active={pathname === "/ai-lab"} ui={ui}>
              <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{t.nav_ai_lab ?? "AI Lab"}</span>
            </PrimaryNavLink>
            <PrimaryNavLink
              href="/explore"
              active={pathname === "/explore"}
              ui={ui}
              onClick={goExplore}
            >
              <span className="whitespace-nowrap">{t.nav_explore}</span>
            </PrimaryNavLink>
            <PrimaryNavLink href="/atom-models" active={pathname === "/atom-models"} ui={ui}>
              <History className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{t.nav_atom_models ?? "Atom Models"}</span>
            </PrimaryNavLink>
            <PrimaryNavLink
              href="/periodic-table"
              active={pathname === "/periodic-table"}
              ui={ui}
            >
              <Grid3X3 className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="whitespace-nowrap">
                {t.nav_periodic_table ?? "Periodic Table"}
              </span>
            </PrimaryNavLink>
            <PrimaryNavLink href="/pricing" active={pathname === "/pricing"} ui={ui}>
              <Zap className="h-3.5 w-3.5 shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{t.nav_pricing ?? "Pricing"}</span>
            </PrimaryNavLink>
          </nav>

          {/* ── Right: utilities + account ── */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <div className="shrink-0">
                <LanguageSelector />
              </div>
              <div className="shrink-0">
                <ThemeToggle />
              </div>
            </div>

            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <AuthNavActions
                isAuthenticated={isAuthenticated}
                user={user}
                credits={credits}
                isWhiteLab={isWhiteLab}
                t={t}
                onLogin={() => openAuthModal("login")}
                onRegister={() => openAuthModal("register")}
                onLogout={logout}
                onBuyCredits={() => {
                  if (isAuthenticated) {
                    openBillingModal();
                  } else {
                    safeNavigate(router, "/pricing");
                  }
                }}
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
                  <MobileNavLink
                    href="/periodic-table"
                    active={pathname === "/periodic-table"}
                    onClick={closeMobileNav}
                    icon={<Grid3X3 className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_periodic_table ?? "Periodic Table"}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/pricing"
                    active={pathname === "/pricing"}
                    onClick={closeMobileNav}
                    icon={<Zap className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_pricing ?? "Pricing"}
                  </MobileNavLink>

                  <div className={cn("my-2 h-px opacity-20", isWhiteLab ? "bg-slate-400" : "bg-white")} />

                  <p className={cn("px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest", ui.typography.muted)}>
                    {t.footer_col_resources ?? "Resources"}
                  </p>
                  <MobileNavLink
                    href="/learn"
                    active={pathname === "/learn"}
                    onClick={closeMobileNav}
                    icon={<BookOpen className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_learn}
                  </MobileNavLink>
                  <MobileNavLink
                    href="/showcase"
                    active={pathname === "/showcase"}
                    onClick={closeMobileNav}
                    icon={<Images className="h-4 w-4 opacity-80" />}
                    ui={ui}
                  >
                    {t.nav_showcase}
                  </MobileNavLink>

                  <div className={cn("my-2 h-px opacity-20", isWhiteLab ? "bg-slate-400" : "bg-white")} />

                  <div className="flex flex-col gap-3 px-1 pb-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium whitespace-nowrap", ui.typography.muted)}>
                        Language
                      </span>
                      <div className="shrink-0">
                        <LanguageSelector />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium whitespace-nowrap", ui.typography.muted)}>
                        Theme
                      </span>
                      <div className="shrink-0">
                        <ThemeToggle />
                      </div>
                    </div>
                    <AuthNavActions
                      isAuthenticated={isAuthenticated}
                      user={user}
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
                        if (isAuthenticated) {
                          openBillingModal();
                        } else {
                          safeNavigate(router, "/pricing");
                        }
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? ui.nav.linkActive
          : cn(ui.nav.link, "[@media(hover:hover)]:hover:text-glow"),
      )}
    >
      {children}
    </Link>
  );
}

function displayUserName(user: AuthUser | null | undefined): string | null {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

function ProfileUserMenu({
  user,
  isWhiteLab,
  t,
  compact,
  stacked,
  onNavigate,
}: {
  user: AuthUser | null | undefined;
  isWhiteLab: boolean;
  t: ReturnType<typeof useLanguage>["t"];
  compact?: boolean;
  stacked?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = displayUserName(user) ?? (t.nav_profile ?? "Profile");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const items = [
    {
      href: "/profile",
      label: t.nav_profile ?? "Profile",
      icon: User,
    },
    {
      href: "/dashboard",
      label: t.nav_dashboard ?? "Dashboard",
      icon: LayoutDashboard,
    },
    {
      href: "/pricing",
      label: t.nav_pricing ?? "Pricing",
      icon: Zap,
    },
  ] as const;

  return (
    <div ref={rootRef} className={cn("relative shrink-0", stacked && "w-full")}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
          compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
          stacked && "w-full justify-center py-2.5",
          isWhiteLab
            ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
            : "border-white/15 bg-white/5 text-gray-200 hover:border-teal-400/40 hover:bg-teal-500/10",
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0" />
        <span className={cn("max-w-[9rem] truncate whitespace-nowrap", compact && "hidden xl:inline")}>
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-70 transition-transform duration-200",
            compact && "hidden xl:inline",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute z-[60] min-w-[11.5rem] overflow-hidden rounded-xl border py-1 shadow-xl",
              stacked ? "left-0 right-0 top-[calc(100%+0.4rem)]" : "right-0 top-[calc(100%+0.45rem)]",
              isWhiteLab
                ? "border-slate-200 bg-white shadow-slate-200/40"
                : "border-white/10 bg-[#0c1015]/95 shadow-black/50 backdrop-blur-xl",
            )}
          >
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => {
                    close();
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors",
                    isWhiteLab
                      ? active
                        ? "bg-slate-100 text-neutral-900"
                        : "text-neutral-700 hover:bg-slate-50"
                      : active
                        ? "bg-[#131920] text-teal-200"
                        : "text-gray-200 hover:bg-[#131920] hover:text-white",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AuthNavActions({
  isAuthenticated,
  user,
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
  user: AuthUser | null | undefined;
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
          stacked ? "flex w-full flex-col gap-2" : "flex shrink-0 gap-2 xl:gap-3",
        )}
      >
        <ProfileUserMenu
          user={user}
          isWhiteLab={isWhiteLab}
          t={t}
          compact={compact}
          stacked={stacked}
        />
        <button
          type="button"
          onClick={onBuyCredits}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border text-xs font-semibold tracking-wide transition-all whitespace-nowrap active:scale-[0.98]",
            compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
            stacked && "w-full justify-center py-2.5",
            isWhiteLab
              ? "border-teal-300/80 bg-teal-50 text-teal-900 shadow-sm hover:bg-teal-100/80"
              : "border-teal-400/40 bg-teal-500/10 text-teal-100 shadow-[0_0_18px_rgba(45,212,191,0.28)] hover:bg-teal-500/15",
          )}
        >
          <Zap className={cn("h-3.5 w-3.5 shrink-0", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
          <span className="whitespace-nowrap">
            {compact ? (credits ?? "—") : `${t.auth_credits_label ?? "Credits"}: ${credits ?? "—"}`}
          </span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
            compact ? "px-2.5 py-1.5" : "px-3 py-1.5",
            stacked && "w-full py-2.5",
            isWhiteLab
              ? "border-slate-300 bg-white text-neutral-800 hover:bg-slate-50"
              : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10",
          )}
          aria-label={t.auth_logout ?? "Logout"}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span className={cn("whitespace-nowrap", compact && "hidden xl:inline")}>
            {t.auth_logout ?? "Logout"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "items-center",
        stacked ? "flex w-full flex-col gap-2" : "flex shrink-0 gap-2",
      )}
    >
      <button
        type="button"
        onClick={onLogin}
        className={cn(
          "shrink-0 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
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
          "shrink-0 rounded-full border text-xs font-semibold transition-all whitespace-nowrap",
          "px-3 py-1.5",
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
        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium whitespace-nowrap transition-all active:scale-[0.99]",
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
