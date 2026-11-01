import Link from "next/link";
import { LegalPage, Owner } from "@/components/legal/LegalPage";
import { SITE_OWNER } from "@/lib/legal/site-owner";
import { JsonLd, organizationJsonLd } from "@/lib/seo/json-ld";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/about");

/** DRAFT About page (D6): what the site is (from the code), who runs it (owner placeholders). */
export default function AboutPage() {
  const o = SITE_OWNER;
  return (
    <LegalPage title="About Molecule Architecture Studio">
      {/* Organization JSON-LD appears only once every owner detail is real (src/lib/seo/json-ld.tsx). */}
      <JsonLd data={[organizationJsonLd()]} />
      <p>
        Molecule Architecture Studio is an interactive chemistry site. You can rotate molecules in 3D in the{" "}
        <Link href="/explore" className="underline">explorer</Link>, read about them on the{" "}
        <Link href="/molecules" className="underline">molecule pages</Link>, step through the history of the atom in the{" "}
        <Link href="/atom-models" className="underline">atomic models</Link>, browse the{" "}
        <Link href="/periodic-table" className="underline">periodic table</Link>, and ask questions in the AI Lab, which
        uses Google&apos;s Gemini model and runs on <Link href="/pricing" className="underline">credits</Link>.
      </p>

      <h2>Who runs it</h2>
      <p>
        <Owner value={o.legalName} />, <Owner value={o.country} />. Contact: <Owner value={o.contactEmail} /> (more on the{" "}
        <Link href="/contact" className="underline">contact page</Link>).
      </p>

      <h2>Where the facts come from</h2>
      <ul>
        <li>
          Periodic table: atomic weights and electron configurations from NIST (US National Institute of Standards and
          Technology); the periodic-table page names the exact databases.
        </li>
        <li>Molecule pages: formulas, molar masses and melting/boiling points checked against PubChem (NCBI).</li>
        <li>The 3D molecule models are schematic illustrations, not measured structures.</li>
      </ul>
    </LegalPage>
  );
}
