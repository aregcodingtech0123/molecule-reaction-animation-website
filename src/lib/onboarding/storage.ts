const LEGACY_KEY_PREFIX = "moleculestudio_has_seen_onboarding:";

/** Spec key: `has_seen_onboarding_${userId}` */
function storageKey(userId: string): string {
  return `has_seen_onboarding_${userId}`;
}

function legacyKey(userId: string): string {
  return `${LEGACY_KEY_PREFIX}${userId}`;
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* private mode / quota — fail open so the modal does not loop */
  }
}

/**
 * Returns true when this account has already acknowledged the welcome modal.
 * Migrates the legacy storage key if present.
 */
export function hasSeenOnboarding(userId: string): boolean {
  if (typeof window === "undefined") return true;
  if (readFlag(storageKey(userId))) return true;
  if (readFlag(legacyKey(userId))) {
    writeFlag(storageKey(userId));
    try {
      window.localStorage.removeItem(legacyKey(userId));
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

export function markOnboardingSeen(userId: string): void {
  if (typeof window === "undefined") return;
  writeFlag(storageKey(userId));
  try {
    window.localStorage.removeItem(legacyKey(userId));
  } catch {
    /* ignore */
  }
}
