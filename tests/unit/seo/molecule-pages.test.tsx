/** Part 2 (D5): molecule page metadata and content for all 14 molecules, from verified facts only. */
import type { ResolvingMetadata } from "next";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import reference from "../../fixtures/molecule-reference.json";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { moleculePageFacts, moleculeSummary, PUBCHEM_CIDS, WITHHELD_ON_MOLECULE_PAGES } from "@/lib/molecules/page-facts";
import { moleculeMetadata } from "@/lib/seo/metadata";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllEnvs());
const parent = Promise.resolve({ openGraph: { images: [] }, twitter: { images: [] } }) as unknown as ResolvingMetadata;
const indexable = () => {
  vi.stubEnv("SITE_URL", "https://studio.example");
  vi.stubEnv("VERCEL_ENV", "");
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function renderPage(id: string): Promise<string> {
  const { default: MoleculePage } = await import("@/app/molecules/[id]/page");
  return renderToString(await MoleculePage(params(id)));
}

describe("molecule page metadata", () => {
  it("each of the 14: own title with name and formula, the answer-first summary as description, self-canonical", async () => {
    indexable();
    const titles = new Set<string>();
    for (const m of ALL_MOLECULES) {
      const meta = await moleculeMetadata(params(m.id), parent);
      expect(meta.title, m.id).toBe(`${m.name} (${m.formula}): structure, properties and uses`);
      expect(meta.description, m.id).toBe(moleculeSummary(moleculePageFacts(m.id)!));
      expect(String(meta.description).length, m.id).toBeGreaterThanOrEqual(50);
      expect(meta.alternates, m.id).toEqual({ canonical: `/molecules/${m.id}` });
      expect(meta.robots, m.id).toBeUndefined();
      titles.add(String(meta.title));
    }
    expect(titles.size).toBe(14);
  });

  it("no canonical while the site is not indexable; nothing for an unknown id", async () => {
    vi.stubEnv("SITE_URL", "");
    expect((await moleculeMetadata(params("water"), parent)).alternates).toBeUndefined();
    expect(await moleculeMetadata(params("xyz"), parent)).toEqual({});
  });

  it("the summary is built from verified fields only (state, molar mass, description or its stand-in)", () => {
    expect(moleculeSummary(moleculePageFacts("caffeine")!)).toBe(
      "Caffeine (C₈H₁₀N₄O₂) is a solid at room temperature with a molar mass of 194.19 g/mol. A central nervous system stimulant found in coffee and tea.",
    );
    // DNA pair: molar mass and state withheld → name, label and description only
    expect(moleculeSummary(moleculePageFacts("dna-fragment")!)).toBe(
      "DNA Base Pair (Adenine–Thymine): a hydrogen-bonded base pair forming the rungs of the DNA double helix.",
    );
    // C60: description withheld → the verified stand-in
    expect(moleculeSummary(moleculePageFacts("buckminsterfullerene")!)).toContain("12 pentagons and 20 hexagons");
    expect(moleculeSummary(moleculePageFacts("buckminsterfullerene")!)).not.toMatch(/aromaticity/);
  });

  it("PubChem CIDs on the pages are the ones the facts were checked against (fixture)", () => {
    const refs = reference.molecules as Record<string, { cid: number }[]>;
    for (const m of ALL_MOLECULES) expect(PUBCHEM_CIDS[m.id], m.id).toEqual(refs[m.id].map((r) => r.cid));
  });
});

describe("molecule page content (server HTML)", () => {
  it("every page: one h1, breadcrumbs, the summary, a link into the 3D explorer, and no withheld item", async () => {
    for (const m of ALL_MOLECULES) {
      const html = await renderPage(m.id);
      expect(html.match(/<h1/g), m.id).toHaveLength(1);
      expect(html, m.id).toContain('aria-label="Breadcrumb"');
      expect(html, m.id).toContain(`href="/explore?molecule=${m.id}"`);
      expect(html, m.id).toContain('href="/molecules"');
      const held = WITHHELD_ON_MOLECULE_PAGES[m.id] ?? {};
      const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      for (const fact of held.funFacts ?? []) expect(text, `${m.id}: ${fact}`).not.toContain(fact);
      for (const bond of held.bondTypes ?? []) expect(text, `${m.id}: ${bond}`).not.toContain(bond);
      if (held.boilingPoint) expect(text, m.id).not.toContain(m.education!.boilingPoint!);
      if (held.molecularWeight) expect(text, m.id).not.toContain(m.education!.molecularWeight);
      if (held.description) expect(text, m.id).not.toContain(m.description);
    }
  });

  it("states no atom/bond counts from the schematic 3D models", async () => {
    const html = await renderPage("caffeine");
    expect(html).not.toMatch(/\b(atoms|bonds) total\b/i);
    expect(html).toContain("schematic illustration");
  });

  it("an unknown id is the site's 404", async () => {
    await expect(renderPage("xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPage("__proto__")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("JSON-LD: a BreadcrumbList only while indexable; Home › Molecules › name, last item without a URL", async () => {
    vi.stubEnv("SITE_URL", "");
    expect(await renderPage("water")).not.toContain("application/ld+json");
    indexable();
    const html = await renderPage("water");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((b) => JSON.parse(b[1]));
    expect(blocks).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://studio.example/" },
          { "@type": "ListItem", position: 2, name: "Molecules", item: "https://studio.example/molecules" },
          { "@type": "ListItem", position: 3, name: "Water" },
        ],
      },
    ]);
  });
});
