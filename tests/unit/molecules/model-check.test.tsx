/**
 * SEO-19 (owner decision after Part 2): atom/bond counts and the element composition are shown only for models that
 * contain exactly their formula's atoms. After the PubChem regeneration only heme is left out.
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

  it("every model has exactly its formula's atoms except heme (PubChem has no 3D record for an iron complex; its model is the old schematic one, one hydrogen short)", () => {
    const failing = ALL_MOLECULES.filter((m) => !modelMatchesFormula(m)).map((m) => m.id);
    expect(failing, JSON.stringify(ALL_MOLECULES.map((m) => [m.id, modelElementCounts(m)]))).toEqual(["heme-group"]);
    expect(modelElementCounts(MOLECULE_MAP["heme-group"])).toMatchObject({ Fe: 1, C: 34, N: 4, O: 4, H: 31 });
  });

  it("the atom total of each regenerated model is the formula's total (PubChem computed conformers, hydrogens included)", () => {
    const totals: Record<string, number> = { glucose: 24, caffeine: 24, "dna-fragment": 30, "protein-fragment": 20, capsaicin: 49, dopamine: 22, adrenaline: 26 };
    for (const [id, total] of Object.entries(totals)) {
      expect(MOLECULE_MAP[id].atoms, id).toHaveLength(total);
      expect(Object.values(elementCounts(REFERENCE_FORMULAS[id])).reduce((a, b) => a + b, 0), id).toBe(total);
    }
  });
});

describe("what the UI shows", () => {
  const info = (id: string) => renderWithProviders(<MoleculeInfoPanel molecule={MOLECULE_MAP[id]} onClose={() => {}} />);

  it("the info panel prints atoms and bonds for a matching model (water: 3 atoms, 2 bonds)", () => {
    info("water");
    expect(screen.getByText(/3 atoms · 2 bonds/i)).toBeTruthy();
  });

  it("caffeine's regenerated model is complete: 24 atoms and 25 bonds are shown", () => {
    info("caffeine");
    expect(screen.getByText(/24 atoms · 25 bonds/i)).toBeTruthy();
  });

  it("…and nothing for the one mismatched model left (heme: counts hidden, molar mass still shown)", () => {
    const { container } = info("heme-group");
    expect(container.textContent).not.toMatch(/\d+ atoms/i);
    expect(container.textContent).not.toMatch(/\b74\b/);
    expect(screen.getByText("616.49")).toBeTruthy();
  });

  it("the sidebar shows 'Na · Nb' for every matching molecule and for none that mismatches (heme)", () => {
    for (const [id, expectedShown] of [["water", true], ["caffeine", true], ["glucose", true], ["methane", true], ["heme-group", false]] as const) {
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
