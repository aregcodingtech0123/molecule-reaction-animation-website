import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { startTransition } from "react";

/**
 * Defer App Router navigation until the client router is initialized.
 * Avoids "Router action dispatched before initialization" during HMR / early mount.
 */
export function safeNavigate(
  router: AppRouterInstance,
  href: string,
  method: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;

  startTransition(() => {
    router[method](href);
  });
}
