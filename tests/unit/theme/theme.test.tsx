import fs from "node:fs";
import path from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { DEFAULT_THEME, THEME_STORAGE_KEY, resolveAppTheme } from "@/lib/theme/types";
import { THEME_UI } from "@/lib/theme/config";

function Probe() {
  const { theme, toggleTheme, isWhiteLab } = useTheme();
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <span data-testid="white">{String(isWhiteLab)}</span>
      <button onClick={toggleTheme}>toggle</button>
    </>
  );
}
const mount = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
const root = document.documentElement;

describe("theme resolution", () => {
  it.each([
    [null, "night-lab"],
    ["", "night-lab"],
    ["night-lab", "night-lab"],
    ["white-lab", "white-lab"],
    ["cyberpunk", "night-lab"],
    ["neon-pink", "night-lab"],
  ])("stored %j → %s", (stored, expected) => {
    expect(resolveAppTheme(stored)).toBe(expected);
  });

  it("Night Lab maps to the `dark` html class, White Lab to none", () => {
    expect(THEME_UI["night-lab"].htmlClass).toBe("dark");
    expect(THEME_UI["white-lab"].htmlClass).toBe("");
    expect(DEFAULT_THEME).toBe("night-lab");
  });
});

describe("ThemeProvider", () => {
  it("defaults to Night Lab with the dark class", () => {
    mount();
    expect(screen.getByTestId("theme")).toHaveTextContent("night-lab");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset.theme).toBe("night-lab");
  });

  it("toggle → White Lab: removes `dark`, sets data-theme, persists; toggling back restores", () => {
    mount();
    act(() => screen.getByRole("button", { name: "toggle" }).click());
    expect(screen.getByTestId("theme")).toHaveTextContent("white-lab");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.dataset.theme).toBe("white-lab");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("white-lab");

    act(() => screen.getByRole("button", { name: "toggle" }).click());
    expect(root.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("night-lab");
  });

  it("restores a persisted White Lab on mount (reload)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "white-lab");
    mount();
    expect(screen.getByTestId("white")).toHaveTextContent("true");
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("migrates the legacy 'cyberpunk' value to 'night-lab' in storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "cyberpunk");
    mount();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("night-lab");
  });

  it("the ThemeToggle control exposes both options with aria-pressed", async () => {
    render(
      <LanguageProvider>
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      </LanguageProvider>,
    );
    const group = screen.getByLabelText("Application theme: Night Lab or White Lab");
    const [night, white] = group.querySelectorAll("button");
    expect(night).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(white!);
    expect(white).toHaveAttribute("aria-pressed", "true");
    expect(root.classList.contains("dark")).toBe(false);
  });
});

describe("pre-hydration theme (flash of wrong theme)", () => {
  const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");

  it("server HTML defaults to Night Lab (`dark` + data-theme) to match the provider's first render", () => {
    expect(layout).toMatch(/className="dark"/);
    expect(layout).toMatch(/data-theme="night-lab"/);
  });

  // FINDING-26 (Low): there is no inline script that applies the persisted theme before
  // hydration, so White Lab users see a Night Lab flash on every full page load.
  it.fails("applies the persisted theme before first paint (inline script reading the theme key) (FINDING-26)", () => {
    expect(layout).toMatch(new RegExp(`<script[\\s\\S]*${THEME_STORAGE_KEY}`));
  });
});
