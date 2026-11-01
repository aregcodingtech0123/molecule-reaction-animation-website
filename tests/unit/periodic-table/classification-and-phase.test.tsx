/**
 * SEO-19 (owner decision after Part 2): categories are labelled "common classification, not an IUPAC designation", Po / Ts / Og
 * carry IUPAC's own wording, oganesson is never drawn as a gas, and elements never made in bulk say so.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../support/mocks";
import { ElementDetailPanel } from "@/components/periodic-table/ElementDetailPanel";
import { PeriodicTableGrid } from "@/components/periodic-table/PeriodicTableGrid";
import { RealWorldView } from "@/components/periodic-table/RealWorldView";
import { CLASSIFICATION_NOTE, iupacNote } from "@/lib/periodic-table/classification";
import { ELEMENTS } from "@/lib/periodic-table/elements";
import { FIRST_ELEMENT_NEVER_MADE_IN_BULK, getPhysicalState } from "@/lib/periodic-table/physical-state";

const by = (s: string) => ELEMENTS.find((e) => e.symbol === s)!;

describe("classification label", () => {
  it("the detail panel says 'Common classification, not an IUPAC designation' for all 118", () => {
    expect(CLASSIFICATION_NOTE).toBe("Common classification, not an IUPAC designation");
    for (const el of ELEMENTS) {
      const { unmount } = renderWithProviders(<ElementDetailPanel element={el} />);
      expect(screen.getByText(CLASSIFICATION_NOTE), el.symbol).toBeTruthy();
      unmount();
    }
  });

  it("the legend under the table says so too", () => {
    const { container } = renderWithProviders(<PeriodicTableGrid selected={null} onSelect={() => {}} />);
    expect(container.textContent).toContain("Categories: common classification, not an iupac designation.");
  });

  it("only Po, Ts and Og carry IUPAC wording, each with its source", () => {
    expect(ELEMENTS.filter((e) => iupacNote(e.symbol)).map((e) => e.symbol)).toEqual(["Po", "Ts", "Og"]);
    expect(iupacNote("Po")).toContain("chalcogens (group 16)");
    expect(iupacNote("Po")).toContain("does not classify it as a metalloid");
    expect(iupacNote("Po")).toContain("IR-3.5");
    expect(iupacNote("Ts")).toContain("group 17");
    expect(iupacNote("Og")).toContain("group 18");
    for (const s of ["Ts", "Og"]) expect(iupacNote(s)).toContain("30 Nov 2016");
    expect(iupacNote("__proto__")).toBeNull();
  });

  it("the panel shows that wording for Po, Ts, Og and for no other element", () => {
    for (const el of ELEMENTS) {
      const { container, unmount } = renderWithProviders(<ElementDetailPanel element={el} />);
      const note = iupacNote(el.symbol);
      if (note) expect(container.textContent, el.symbol).toContain(note);
      else expect(container.textContent, el.symbol).not.toMatch(/IUPAC (places|lists)/);
      unmount();
    }
  });

  it("the common categories themselves are unchanged (Po stays metalloid, Ts halogen, Og noble gas)", () => {
    expect([by("Po").category, by("Ts").category, by("Og").category]).toEqual(["metalloid", "halogen", "noble-gas"]);
  });
});

describe("phase illustration", () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network"))));

  it("oganesson is not a gas; it says the state is unknown", () => {
    expect(getPhysicalState(118)).toBe("unknown");
    const { container } = renderWithProviders(<RealWorldView element={by("Og")} />);
    expect(container.textContent).toContain("State unknown / not produced in bulk");
    expect(container.textContent).not.toMatch(/Crystalline solid|Simulated discharge glow|gas/i);
  });

  it("the states over all 118: 11 gases, 2 liquids, 21 unknown (At, Fr, Fm-Og), 84 solids", () => {
    const counts: Record<string, string[]> = { gas: [], liquid: [], solid: [], unknown: [] };
    for (const el of ELEMENTS) counts[getPhysicalState(el.atomicNumber)].push(el.symbol);
    expect(counts.gas).toEqual(["H", "He", "N", "O", "F", "Ne", "Cl", "Ar", "Kr", "Xe", "Rn"]);
    expect(counts.liquid).toEqual(["Br", "Hg"]);
    expect(counts.unknown).toEqual(["At", "Fr", ...ELEMENTS.filter((e) => e.atomicNumber >= FIRST_ELEMENT_NEVER_MADE_IN_BULK).map((e) => e.symbol)]);
    expect(counts.unknown).toHaveLength(21);
    expect(counts.solid).toHaveLength(84);
  });

  it("every element's panel says exactly one thing: gas cloud, liquid, solid or unknown; 'Crystalline solid' never appears for an unknown one", () => {
    for (const el of ELEMENTS) {
      const state = getPhysicalState(el.atomicNumber);
      const { container, unmount } = renderWithProviders(<RealWorldView element={el} />);
      const text = container.textContent ?? "";
      expect(text.includes("Simulated discharge glow"), el.symbol).toBe(state === "gas");
      expect(text.includes("Liquid phase"), el.symbol).toBe(state === "liquid");
      expect(text.includes("Crystalline solid"), el.symbol).toBe(state === "solid");
      expect(text.includes("State unknown / not produced in bulk"), el.symbol).toBe(state === "unknown");
      unmount();
    }
  });
});
