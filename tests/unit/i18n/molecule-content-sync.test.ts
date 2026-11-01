/**
 * The Explore UI, the quick-facts panel and the home page show the locale bundle's text for a molecule's description,
 * bond types, uses and fun facts (localizeMolecule), not src/lib/molecules/data.ts. A fact corrected or removed in the data
 * must therefore be corrected or removed in every bundle, or the old claim stays on screen. English is the same text as
 * the data; every other locale has the same number of statements in the same order: a translation of the same item, or,
 * where the statement was added or reworded after the translation was made, the English text itself (never a stale
 * translation of a claim that no longer exists).
 */
import { describe, expect, it } from "vitest";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import type { LocaleContentBundle } from "@/lib/i18n/content";
import en from "@/lib/i18n/content/en.json";
import tr from "@/lib/i18n/content/tr.json";
import de from "@/lib/i18n/content/de.json";
import es from "@/lib/i18n/content/es.json";
import pt from "@/lib/i18n/content/pt.json";
import ko from "@/lib/i18n/content/ko.json";
import ja from "@/lib/i18n/content/ja.json";
import fr from "@/lib/i18n/content/fr.json";
import ru from "@/lib/i18n/content/ru.json";
import zh from "@/lib/i18n/content/zh.json";
import it_ from "@/lib/i18n/content/it.json";
import hi from "@/lib/i18n/content/hi.json";

const OTHERS: Record<string, LocaleContentBundle> = { tr, de, es, pt, ko, ja, fr, ru, zh, it: it_, hi } as unknown as Record<string, LocaleContentBundle>;
const EN = en as unknown as LocaleContentBundle;

describe("molecule text in the locale bundles matches the data", () => {
  it("covers every molecule", () => {
    expect(Object.keys(EN.molecules).sort()).toEqual(expect.arrayContaining(ALL_MOLECULES.map((m) => m.id).sort()));
  });

  it.each(ALL_MOLECULES.map((m) => [m.id, m] as const))("English bundle = data for %s", (_id, m) => {
    const o = EN.molecules[m.id];
    expect(o.name).toBe(m.name);
    expect(o.description).toBe(m.description);
    expect(o.bondTypes).toEqual(m.education?.bondTypes ?? []);
    expect(o.uses).toEqual(m.education?.uses ?? []);
    expect(o.funFacts).toEqual(m.education?.funFacts ?? []);
  });

  describe.each(Object.entries(OTHERS))("locale %s", (_loc, bundle) => {
    it.each(ALL_MOLECULES.map((m) => [m.id, m] as const))("%s has one translation per statement, same order", (_id, m) => {
      const o = bundle.molecules[m.id];
      expect(o.bondTypes).toHaveLength(m.education?.bondTypes?.length ?? 0);
      expect(o.uses).toHaveLength(m.education?.uses?.length ?? 0);
      expect(o.funFacts).toHaveLength(m.education?.funFacts?.length ?? 0);
      for (const s of [o.description, ...o.bondTypes, ...o.uses, ...o.funFacts]) expect(s.trim().length).toBeGreaterThan(0);
    });
  });
});

describe("claims that were corrected or removed are gone from every bundle", () => {
  const ENGLISH_GONE = [
    "Mpemba", "9 days", "three physical states", "Glycosidic", "600 times", "100,000", "0.05 seconds", "63mg", "80 cups",
    "Nobel-celebrated", "tug-of-war", "120g", "1.09 Å", "80× more potent", "CRISPR", "Willow bark", "fuel bio-additives",
    "membrane fluidity", "survive stomach acid", "nociceptor theater", "serum, where", "Teaching ligand", "Birds often lack",
    "joyride", "UK/US naming", "popularized geodesic", "Physiology demos", "peptide drug design",
    "4 Calories", "Hydroelectric", "IV glucose", "Amide Resonance", "partial double-bond", "Universal biological solvent", "sigmoidal",
    "universal solvent", "heating and cooking", "Sports and energy",
    "surprisingly influential", "one tiny tablet", "mesolimbic myths", "jumps in the bushes", "Euler", "allostery backstage", "vasoconstriction stories",
  ];
  it("the English bundle contains none of them", () => {
    const text = JSON.stringify(EN.molecules);
    for (const gone of ENGLISH_GONE) expect(text, gone).not.toContain(gone);
  });

  it("a locale whose translation is stale holds the English data text for that statement (dopamine, blood-brain barrier fact)", () => {
    const data = ALL_MOLECULES.find((m) => m.id === "dopamine")!.education!.funFacts;
    for (const [loc, bundle] of Object.entries(OTHERS)) {
      expect(bundle.molecules.dopamine.funFacts[1], loc).toBe(data[1]); // reworded after the translation: English
      expect(bundle.molecules.dopamine.funFacts[0], loc).not.toBe(data[0]); // unchanged statement keeps its translation
    }
  });
});
