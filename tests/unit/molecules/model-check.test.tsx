/**
 * SEO-19 (owner decision after Part 2): atom/bond counts and the element composition are shown only for models that
 * contain exactly their formula's atoms.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import reference from "../../fixtures/molecule-reference.json";
import { renderWithProviders } from "../../support/mocks";
import { MoleculeInfoPanel } from "@/components/canvas/MoleculeInfoPanel";
import { ExploreSidebarContent } from "@/components/explore/ExploreSidebarContent";
import { ALL_MOLECULES, MOLECULE_MAP } from "@/lib/molecules/data";
import { elementCounts, modelElementCounts, modelMatchesFormula, REFERENCE_FORMULAS } from "@/lib/molecules/model-check";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const refs = reference.molecules as Record<string, { formula: string }[]>;

describe("reference formulas", () => {
  it("are PubChem's computed formulas for all 14 molecules (fixture)", () => {
    expect(Object.keys(REFERENCE_FORMULAS).sort()).toEqual(ALL_MOLECULES.map((m) => m.id).sort());
    for (const m of ALL_MOLECULES) expect([...REFERENCE_FORMULAS[m.id]], m.id).toEqual(refs[m.id].map((r) => r.formula));
  });

  it("elementCounts parses and sums formulas", () => {
    expect(elementCounts(["C8H10N4O2"])).toEqual({ C: 8, H: 10, N: 4, O: 2 });
    expect(elementCounts(["C5H5N5", "C5H6N2O2"])).toEqual({ C: 10, H: 11, N: 7, O: 2 });
    expect(elementCounts(["C34H32FeN4O4"])).toMatchObject({ Fe: 1, C: 34 });
  });
});

describe("modelMatchesFormula", () => {
  it("a model not in the reference (an AI Lab structure from PubChem) is not checked", () => {
    expect(modelMatchesFormula({ id: "smiles-from-chat", atoms: [] })).toBe(true);
    expect(modelMatchesFormula({ id: "__proto__", atoms: [] })).toBe(true);
  });

  it("a model missing an atom, or with an extra one, fails", () => {
    const water = MOLECULE_MAP.water;
    expect(modelMatchesFormula(water)).toBe(true);
    expect(modelMatchesFormula({ id: "water", atoms: water.atoms.slice(1) })).toBe(false);
    expect(modelMatchesFormula({ id: "water", atoms: [...water.atoms, water.atoms[1]] })).toBe(false);
  });

  it("today the eight mismatched models fail and the other six pass (this changes when they are regenerated)", () => {
    const failing = ALL_MOLECULES.filter((m) => !modelMatchesFormula(m)).map((m) => m.id).sort();
    expect(failing, JSON.stringify(ALL_MOLECULES.map((m) => [m.id, modelElementCounts(m)]))).toEqual(
      ["adrenaline", "caffeine", "capsaicin", "dna-fragment", "dopamine", "glucose", "heme-group", "protein-fragment"],
    );
  });
});

describe("what the UI shows", () => {
  const info = (id: string) => renderWithProviders(<MoleculeInfoPanel molecule={MOLECULE_MAP[id]} onClose={() => {}} />);

  it("the info panel prints atoms and bonds for a matching model (water: 3 atoms, 2 bonds)", () => {
    info("water");
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText(/3 atoms · 2 bonds/i)).toBeTruthy();
  });

  it("…and nothing for a mismatched one (caffeine's model has 15 atoms and 16 bonds)", () => {
    const { container } = info("caffeine");
    expect(screen.queryByText(/15 atoms/i)).toBeNull();
    expect(container.textContent).not.toMatch(/\b15\b/);
    expect(container.textContent).not.toMatch(/\b16\b/);
    expect(screen.getByText("194.19")).toBeTruthy(); // the molar mass is still shown
  });

  it("the sidebar shows '15a · 16b' for no mismatched molecule and '3a · 2b' for water", () => {
    for (const [id, expectedShown] of [["water", true], ["caffeine", false], ["glucose", false], ["methane", true]] as const) {
      const { container, unmount } = renderWithProviders(
        <ExploreSidebarContent
          activeMode="explorer"
          molecules={ALL_MOLECULES}
          reactions={[]}
          activeMoleculeId={id}
          activeReactionId=""
          onSelectMolecule={() => {}}
          onSelectReaction={() => {}}
        />,
      );
      expect(/\d+a · \d+b/.test(container.textContent ?? ""), id).toBe(expectedShown);
      unmount();
    }
  });
});
