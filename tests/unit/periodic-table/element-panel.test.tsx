/** SEO-19: how a mass number differs from a standard atomic weight on screen, and the NIST attribution on the page. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../support/mocks";
import { ElementCell } from "@/components/periodic-table/ElementCell";
import { ElementDetailPanel } from "@/components/periodic-table/ElementDetailPanel";
import PeriodicTablePage from "@/app/periodic-table/page";
import { ELEMENTS } from "@/lib/periodic-table/elements";

vi.mock("@/components/periodic-table/RealWorldView", () => ({ RealWorldView: () => null }));

const by = (s: string) => ELEMENTS.find((e) => e.symbol === s)!;

describe("ElementDetailPanel mass", () => {
  it("a standard weight is 'Atomic Mass' in u", () => {
    renderWithProviders(<ElementDetailPanel element={by("Yb")} />);
    expect(screen.getByText("Atomic Mass")).toBeTruthy();
    expect(screen.getByText("173.054 u")).toBeTruthy();
    expect(screen.queryByText(/longest-lived/i)).toBeNull();
  });

  it("hassium is a mass number of a known isotope (no longest-lived claim past Z 94), never an 'Atomic Mass' in u", () => {
    renderWithProviders(<ElementDetailPanel element={by("Hs")} />);
    expect(screen.getByText("Mass number")).toBeTruthy();
    expect(screen.getByText("270")).toBeTruthy();
    expect(screen.getByText("No stable isotope — mass number of a known isotope")).toBeTruthy();
    expect(screen.queryByText(/longest-lived/i)).toBeNull();
    expect(screen.queryByText("Atomic Mass")).toBeNull();
    expect(screen.queryByText(/\d u$/)).toBeNull();
  });

  it("all 118: a no-standard-weight element uses the mass-number presentation, every other the atomic-mass one", () => {
    for (const el of ELEMENTS) {
      const { unmount } = renderWithProviders(<ElementDetailPanel element={el} />);
      const massNumber = el.atomicMassKind === "mass-number";
      expect(screen.queryByText("Mass number") !== null, el.symbol).toBe(massNumber);
      expect(screen.queryByText("Atomic Mass") !== null, el.symbol).toBe(!massNumber);
      unmount();
    }
  });
});

describe("mass-number note: NIST-supported wording only (owner decision)", () => {
  it("Z 43-94 without a standard weight (NIST brackets the longest-lived isotope) say 'longest-lived'; Z 95-118 say only 'a known isotope'", () => {
    const massNumberElements = ELEMENTS.filter((e) => e.atomicMassKind === "mass-number");
    expect(massNumberElements).toHaveLength(34);
    for (const el of massNumberElements) {
      const { unmount } = renderWithProviders(<ElementDetailPanel element={el} />);
      if (el.atomicNumber <= 94) {
        expect(screen.getByText("No stable isotope — longest-lived isotope"), el.symbol).toBeTruthy();
      } else {
        expect(screen.getByText("No stable isotope — mass number of a known isotope"), el.symbol).toBeTruthy();
        // nothing on the panel (note or description) claims a longest-lived isotope for these 24
        expect(screen.queryByText(/longest-lived/i), el.symbol).toBeNull();
      }
      unmount();
    }
  });
});

describe("ElementCell mass", () => {
  it("shows a bracketed mass number for Hs and two decimals for Yb", () => {
    const { container, rerender } = renderWithProviders(<ElementCell element={by("Hs")} isActive={false} onSelect={() => {}} />);
    expect(within(container).getByText("[270]")).toBeTruthy();
    rerender(<ElementCell element={by("Yb")} isActive={false} onSelect={() => {}} />);
    expect(within(container).getByText("173.05")).toBeTruthy();
  });
});

describe("periodic-table page attribution", () => {
  it("credits NIST for the masses and the electron configurations, says what was changed, and links the sources", () => {
    const { container } = renderWithProviders(<PeriodicTablePage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/standard atomic weights from NIST/);
    expect(text).toMatch(/rounded to three decimals/);
    expect(text).toMatch(/Kramida, A\., Ralchenko, Yu\., Reader, J\. and NIST ASD Team \(2024\)/);
    expect(text).toMatch(/NIST lists no measured ground state for elements 109–118/);
    expect(text).toContain("from americium (95) on, where NIST gives none, the mass number of a known isotope");
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://physics.nist.gov/asd");
    expect(hrefs).toContain("https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl");
    // CIAAW values are never displayed (licence); IUPAC is cited only for the category wording
    expect(text).not.toMatch(/CIAAW|Nubase|Abridged Standard Atomic Weights/);
    expect(text).toContain("follow the common textbook classification, not IUPAC designations");
    expect(text).toContain("IUPAC Red Book 2005, IR-3.5");
  });
});
