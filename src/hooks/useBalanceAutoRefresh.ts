"use client";

import { useEffect, useRef } from "react";
import { clearCheckoutWatch, readCheckoutWatch } from "@/lib/billing/checkout-watch";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30_000;

/** Fired after a poll or focus refresh lands new credits, so ledger views can reload. */
export const CREDITS_REFRESHED_EVENT = "moleculestudio:credits-refreshed";

export interface UseBalanceAutoRefreshOptions {
  isHydrated: boolean;
  isAuthenticated: boolean;
  /** Refetches the balance and resolves with the new value, or null if unavailable. */
  fetchBalance: () => Promise<number | null>;
  onCreditsIncreased?: (balance: number, previous: number | null) => void;
}

/**
 * Keeps the displayed credit balance honest without a page reload.
 *
 * Two independent triggers:
 *
 * 1. Focus / visibility — the user tabs back from anywhere (including a payment
 *    page opened in another tab) and the balance refreshes once.
 *
 * 2. Post-checkout poll — after returning from a hosted checkout, credits land
 *    asynchronously via webhook, so the balance is usually still stale on the
 *    first paint. This polls every 3s for up to 30s and stops the moment the
 *    balance rises above the pre-checkout baseline.
 *
 * The poll is bounded on both ends: it stops early on success and gives up at
 * the deadline, so a webhook that never arrives cannot leave a timer running.
 */
export function useBalanceAutoRefresh(options: UseBalanceAutoRefreshOptions): void {
  const { isHydrated, isAuthenticated } = options;

  const fetchBalanceRef = useRef(options.fetchBalance);
  const onIncreaseRef = useRef(options.onCreditsIncreased);
  fetchBalanceRef.current = options.fetchBalance;
  onIncreaseRef.current = options.onCreditsIncreased;

  // ── 1. Refresh when the tab regains focus ────────────────────────────────
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;

    let inFlight = false;

    const refresh = () => {
      // Skip while hidden: visibilitychange also fires on the way *out*.
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void fetchBalanceRef.current().finally(() => {
        inFlight = false;
      });
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isHydrated, isAuthenticated]);

  // ── 2. Poll after returning from checkout ────────────────────────────────
  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;

    const watch = readCheckoutWatch();
    if (!watch) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const tick = async () => {
      if (cancelled) return;

      let balance: number | null = null;
      try {
        balance = await fetchBalanceRef.current();
      } catch {
        // A failed poll is not fatal; the next tick may succeed.
      }
      if (cancelled) return;

      const increased =
        balance !== null && watch.baseline !== null && balance > watch.baseline;

      if (increased) {
        clearCheckoutWatch();
        onIncreaseRef.current?.(balance as number, watch.baseline);
        window.dispatchEvent(new CustomEvent(CREDITS_REFRESHED_EVENT));
        return;
      }

      if (Date.now() >= deadline) {
        // Credits may still arrive later; the focus listener will pick them up.
        clearCheckoutWatch();
        return;
      }

      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isHydrated, isAuthenticated]);
}
