const STORAGE_KEY = "moleculestudio.checkout-watch";

/** Abandon a watch this old — the user almost certainly never completed payment. */
const MAX_AGE_MS = 15 * 60 * 1000;

export interface CheckoutWatch {
  /** Balance at the moment checkout was opened; the poll waits for a value above this. */
  baseline: number | null;
  startedAt: number;
  packageId: string;
}

/**
 * Record that a hosted checkout is in flight.
 *
 * Lemon Squeezy checkout is a full-page redirect, so the tab unloads and every
 * bit of React state dies with it. A poll cannot be started at the moment of
 * purchase — it has to be resumed when the user lands back on the app. This
 * marker is what survives the round trip.
 *
 * sessionStorage (not localStorage) on purpose: the watch belongs to this tab's
 * journey, and it should not leak into other tabs or outlive the session.
 */
export function markCheckoutStarted(packageId: string, baseline: number | null): void {
  try {
    const watch: CheckoutWatch = { baseline, startedAt: Date.now(), packageId };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(watch));
  } catch {
    // Private mode or blocked storage — polling is an enhancement, not a
    // requirement, and the focus listener still covers the common case.
  }
}

export function readCheckoutWatch(): CheckoutWatch | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CheckoutWatch>;
    if (typeof parsed?.startedAt !== "number") return null;

    if (Date.now() - parsed.startedAt > MAX_AGE_MS) {
      clearCheckoutWatch();
      return null;
    }

    return {
      baseline: typeof parsed.baseline === "number" ? parsed.baseline : null,
      startedAt: parsed.startedAt,
      packageId: typeof parsed.packageId === "string" ? parsed.packageId : "",
    };
  } catch {
    return null;
  }
}

export function clearCheckoutWatch(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
