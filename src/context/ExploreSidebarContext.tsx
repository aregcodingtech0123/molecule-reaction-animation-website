"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface ExploreSidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const ExploreSidebarContext = createContext<ExploreSidebarContextValue | null>(null);

export function ExploreSidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <ExploreSidebarContext.Provider value={value}>{children}</ExploreSidebarContext.Provider>
  );
}

export function useExploreSidebar() {
  const ctx = useContext(ExploreSidebarContext);
  if (!ctx) {
    throw new Error("useExploreSidebar must be used within ExploreSidebarProvider");
  }
  return ctx;
}

/** Safe for Navbar — returns null outside provider (should not happen once provider is mounted). */
export function useExploreSidebarOptional() {
  return useContext(ExploreSidebarContext);
}
