"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { hasSeenOnboarding } from "@/lib/onboarding/storage";

/**
 * Whether the current logged-in user should see the first-time Welcome modal.
 * Requires a hydrated session and no prior `has_seen_onboarding_${userId}` flag.
 */
export function useNeedsOnboarding(): {
  ready: boolean;
  needsOnboarding: boolean;
  userId: string | null;
} {
  const { isHydrated, isAuthenticated, user, authModalOpen, billingModalOpen } = useAuth();

  return useMemo(() => {
    const userId = user?.id ?? null;
    const ready = isHydrated && isAuthenticated && Boolean(userId);

    if (!ready || !userId) {
      return { ready: false, needsOnboarding: false, userId };
    }

    // Don't stack over auth/billing dialogs.
    if (authModalOpen || billingModalOpen) {
      return { ready: true, needsOnboarding: false, userId };
    }

    return {
      ready: true,
      needsOnboarding: !hasSeenOnboarding(userId),
      userId,
    };
  }, [
    isHydrated,
    isAuthenticated,
    user?.id,
    authModalOpen,
    billingModalOpen,
  ]);
}
