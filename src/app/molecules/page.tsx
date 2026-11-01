import Link from "next/link";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import type { MoleculeCategory } from "@/lib/molecules/types";
import { breadcrumbJsonLd, JsonLd } from "@/lib/seo/json-ld";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/molecules");

const CATEGORY_TITLES: Record<MoleculeCategory, string> = {
  simple: "Simple molecules",
  organic: "Organic molecules",
  biological: "Biological molecules",
  inorganic: "Inorganic molecules",
  macro: "Large molecules",
};

/** Index of the molecule pages (Part 2): every molecule, grouped by the category the data already gives it. */
export default function MoleculesIndexPage() {
  const groups = (Object.keys(CATEGORY_TITLES) as MoleculeCategory[])
    .map((category) => ({ category, molecules: ALL_MOLECULES.filter((m) => m.category === category) }))
    .filter((g) => g.molecules.length > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-28 sm:px-6">
      <JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Molecules" }])]} />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex gap-1.5">
          <li>
            <Link href="/" className="hover:underline">Home</Link> ›
          </li>
          <li aria-current="page">Molecules</li>
        </ol>
      </nav>
      <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">Molecules</h1>
      <p className="mt-3 text-base leading-relaxed">
        {ALL_MOLECULES.length} molecules you can rotate in 3D in the explorer. Each page gives the formula, molar mass,
        melting and boiling points where they apply, the bonding, common uses, and a link to open the molecule in 3D.
      </p>

      {groups.map(({ category, molecules }) => (
        <section key={category} aria-labelledby={`cat-${category}`} className="mt-10">
          <h2 id={`cat-${category}`} className="text-xl font-semibold">{CATEGORY_TITLES[category]}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {molecules.map((m) => (
              <li key={m.id} className="rounded-2xl border border-current/15 p-4">
                <Link href={`/molecules/${m.id}`} className="font-semibold hover:underline">
                  {m.name}
                </Link>{" "}
                <span className="font-mono text-sm text-muted-foreground">{m.formula}</span>
                <p className="mt-1 text-sm">
                  <Link href={`/explore?molecule=${encodeURIComponent(m.id)}`} className="text-muted-foreground hover:underline">
                    Open in 3D
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
