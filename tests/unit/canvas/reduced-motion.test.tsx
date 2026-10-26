/**
 * R14: the 3D scenes stop their ambient motion (camera auto-rotate, idle spin / float, particle drift) when the
 * visitor prefers reduced motion. The hook follows the media query live; the scene components read it
 * (verified in the browser by `node scripts/perf/run.mjs runtime` step 3: consecutive canvas frames identical).
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return {
    set(next: boolean) {
      matches = next;
      for (const l of listeners) l();
    },
    listeners,
  };
}

function Probe() {
  return <span data-testid="reduce">{String(usePrefersReducedMotion())}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reports the preference and follows it live", () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("reduce")).toHaveTextContent("false");
    act(() => media.set(true));
    expect(screen.getByTestId("reduce")).toHaveTextContent("true");
    act(() => media.set(false));
    expect(screen.getByTestId("reduce")).toHaveTextContent("false");
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("is true from the first render when the preference is already set", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("reduce")).toHaveTextContent("true");
  });
});
