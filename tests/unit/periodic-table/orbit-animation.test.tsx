/** SEO-21: the orbit animation draws the NIST shells (not a fill-in-order guess) and nothing for Z 109-118. */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../support/mocks";
import { AtomicOrbitAnimation } from "@/components/periodic-table/AtomicOrbitAnimation";
import { ELEMENTS } from "@/lib/periodic-table/elements";

const element = (symbol: string) => ELEMENTS.find((e) => e.symbol === symbol)!;
/** Electron dots are the 2×2 rounded spans; the symbol bubble is a div. */
const electrons = (container: HTMLElement) => container.querySelectorAll("span.h-2.w-2").length;
/** One rotating ring (a bordered rounded div that holds the electrons) per occupied shell. */
const rings = (container: HTMLElement) => Array.from(container.querySelectorAll("div.border")).filter((d) => d.querySelector("span.h-2.w-2")).length;

describe("AtomicOrbitAnimation", () => {
  it.each([
    ["K", 19, 4],
    ["Cr", 24, 4],
    ["Cu", 29, 4],
    ["Fe", 26, 4],
    ["Pd", 46, 4],
    ["Lr", 103, 7],
  ])("%s draws %i electrons in %i shells", (symbol, z, shellCount) => {
    const { container } = renderWithProviders(<AtomicOrbitAnimation element={element(symbol)} />);
    expect(electrons(container)).toBe(z);
    expect(rings(container)).toBe(shellCount);
    expect(screen.queryByText(/not been measured/i)).toBeNull();
  });

  it("oganesson: no electrons are drawn, and the page says why", () => {
    const { container } = renderWithProviders(<AtomicOrbitAnimation element={element("Og")} />);
    expect(electrons(container)).toBe(0);
    expect(screen.getByText(/ground-state configuration of this element has not been measured/i)).toBeTruthy();
  });

  it("every element 1-108 draws exactly Z electrons", () => {
    for (const el of ELEMENTS.filter((e) => e.atomicNumber <= 108)) {
      const { container, unmount } = renderWithProviders(<AtomicOrbitAnimation element={el} />);
      expect(electrons(container), el.symbol).toBe(el.atomicNumber);
      unmount();
    }
  });
});

describe("Z 109-118 (no measured ground state)", () => {
  it.each(ELEMENTS.filter((e) => e.atomicNumber >= 109).map((e) => [e.symbol, e.atomicNumber] as const))(
    "%s (%i): nucleus only, with the note",
    (symbol) => {
      const { container, unmount } = renderWithProviders(<AtomicOrbitAnimation element={element(symbol)} />);
      expect(electrons(container)).toBe(0);
      expect(rings(container)).toBe(0);
      expect(screen.getByText(/ground-state configuration of this element has not been measured/i)).toBeTruthy();
      unmount();
    },
  );
});
