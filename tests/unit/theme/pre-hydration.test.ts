/**
 * FINDING-26: the inline <head> script applies the persisted theme to <html>
 * before first paint — executed here exactly as the browser would run it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { themeInitScript } from "@/lib/theme/pre-hydration";
import { THEME_STORAGE_KEY, resolveAppTheme } from "@/lib/theme/types";

const root = document.documentElement;

function serverDefaults() {
  root.className = "dark";
  root.setAttribute("data-theme", "night-lab");
}

const run = () => new Function(themeInitScript(THEME_STORAGE_KEY))();

afterEach(() => {
  localStorage.clear();
  serverDefaults();
});

describe("themeInitScript (FINDING-26)", () => {
  it.each([
    ["white-lab"],
    ["night-lab"],
    ["cyberpunk"],
    ["neon-pink"],
    [""],
    [null],
  ])("stored %j → <html> matches resolveAppTheme before React runs", (stored) => {
    serverDefaults();
    if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
    run();
    const expected = resolveAppTheme(stored);
    expect(root.dataset.theme).toBe(expected);
    expect(root.classList.contains("dark")).toBe(expected === "night-lab");
  });

  it("never throws when storage is blocked (privacy mode, sandboxed iframe)", () => {
    serverDefaults();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(run).not.toThrow();
    expect(root.dataset.theme).toBe("night-lab");
  });

  it("is a self-contained expression that cannot break out of its <script> element", () => {
    const code = themeInitScript(THEME_STORAGE_KEY);
    expect(code).not.toMatch(/<\/script/i);
    expect(code).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});
