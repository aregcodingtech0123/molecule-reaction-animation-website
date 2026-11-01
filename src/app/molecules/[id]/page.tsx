import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { modelCredit } from "@/lib/molecules/model-check";
import { moleculePageFacts, moleculeSummary, PUBCHEM_CIDS } from "@/lib/molecules/page-facts";
import { breadcrumbJsonLd, JsonLd } from "@/lib/seo/json-ld";
import { moleculeMetadata } from "@/lib/seo/metadata";

/**
 * One server-rendered page per molecule (D5, Part 2 design note §1). Everything is in the first HTML; no 3D canvas
 * here — "Open in the 3D explorer" links into the workbench. Only facts that passed the PubChem check are shown
 * (src/lib/molecules/page-facts.ts); an unknown id is the site's 404.
 */
export const generateMetadata = moleculeMetadata;

const STATE_LABEL: Record<string, string> = { solid: "Solid", liquid: "Liquid", gas: "Gas", plasma: "Plasma" };

export default async function MoleculePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = moleculePageFacts(id);
  if (!facts) notFound();
  const { molecule } = facts;
  const related = ALL_MOLECULES.filter((m) => m.category === molecule.category && m.id !== molecule.id);
  const cids = PUBCHEM_CIDS[molecule.id] ?? [];
  const rows: [string, string | null][] = [
    ["Formula", molecule.formula],
    ["Molar mass", facts.molecularWeight],
    ["State at room temperature", facts.state ? (STATE_LABEL[facts.state] ?? facts.state) : null],
    ["Melting point", facts.meltingPoint],
    ["Boiling point", facts.boilingPoint],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-28 sm:px-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Molecules", path: "/molecules" },
            { name: molecule.name },
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap gap-1.5">
          <li>
            <Link href="/" className="hover:underline">Home</Link> ›
          </li>
          <li>
            <Link href="/molecules" className="hover:underline">Molecules</Link> ›
          </li>
          <li aria-current="page">{molecule.name}</li>
        </ol>
      </nav>

      <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">{molecule.name}</h1>
      <p className="mt-3 text-base leading-relaxed">{moleculeSummary(facts)}</p>

      <p className="mt-5">
        <Link
          href={`/explore?molecule=${encodeURIComponent(molecule.id)}`}
          className="inline-flex rounded-full border border-current/25 px-4 py-2 text-sm font-semibold hover:underline"
        >
          Open {molecule.name} in the 3D explorer
        </Link>
      </p>

      <section aria-labelledby="facts" className="mt-10">
        <h2 id="facts" className="text-xl font-semibold">Key facts</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {rows
            .filter((row): row is [string, string] => Boolean(row[1]))
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </section>

      {facts.bondTypes.length > 0 && (
        <section aria-labelledby="bonding" className="mt-8">
          <h2 id="bonding" className="text-xl font-semibold">Bonding and structure</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {facts.bondTypes.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </section>
      )}

      {facts.uses.length > 0 && (
        <section aria-labelledby="uses" className="mt-8">
          <h2 id="uses" className="text-xl font-semibold">Uses</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {facts.uses.map((u) => <li key={u}>{u}</li>)}
          </ul>
        </section>
      )}

      {facts.funFacts.length > 0 && (
        <section aria-labelledby="more" className="mt-8">
          <h2 id="more" className="text-xl font-semibold">Did you know?</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {facts.funFacts.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-10">
          <h2 id="related" className="text-xl font-semibold">Related molecules</h2>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {related.map((m) => (
              <li key={m.id}>
                <Link href={`/molecules/${m.id}`} className="rounded-full border border-current/20 px-3 py-1.5 hover:underline">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
        Formula, molar mass and melting/boiling points checked against PubChem (NCBI):{" "}
        {cids.map((cid, i) => (
          <span key={cid}>
            {i > 0 && ", "}
            <a href={`https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`} rel="noopener noreferrer" target="_blank" className="underline">
              CID {cid}
            </a>
          </span>
        ))}
        . {modelCredit(molecule.id)}
      </p>
    </main>
  );
}
