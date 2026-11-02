import Link from "next/link";
import { LegalPage, OwnerEmail } from "@/components/legal/LegalPage";
import { getSiteOwner } from "@/lib/legal/site-owner";
import { JsonLd, organizationJsonLd } from "@/lib/seo/json-ld";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/about");
// The operator's details come from SITE_OWNER_* variables, read on every request.
export const dynamic = "force-dynamic";

/** About page (D6): what the site is (from the code) and, when the owner has given them, who runs it. */
export default function AboutPage() {
  const o = getSiteOwner();
  const operator = [o.legalName, o.country].filter(Boolean).join(", ");
  return (
    <LegalPage title="About Molecule Architecture Studio">
      {/* Organization JSON-LD appears only once every required owner variable is set (src/lib/seo/json-ld.tsx). */}
      <JsonLd data={[organizationJsonLd()]} />
      <p>
        Molecule Architecture Studio is an interactive chemistry site. You can rotate molecules in 3D in the{" "}
        <Link href="/explore" className="underline">explorer</Link>, read about them on the{" "}
        <Link href="/molecules" className="underline">molecule pages</Link>, step through the history of the atom in the{" "}
        <Link href="/atom-models" className="underline">atomic models</Link>, browse the{" "}
        <Link href="/periodic-table" className="underline">periodic table</Link>, and ask questions in the AI Lab, which
        uses Google&apos;s Gemini model and runs on <Link href="/pricing" className="underline">credits</Link>.
      </p>

      {(operator || o.contactEmail) && (
        <>
          <h2>Who runs it</h2>
          <p>
            {operator}
            {operator && o.registrationNumber ? ` (registration number ${o.registrationNumber})` : ""}
            {operator && o.contactEmail ? ". " : ""}
            {o.contactEmail && (
              <>
                Contact: <OwnerEmail value={o.contactEmail} /> (more on the{" "}
                <Link href="/contact" className="underline">contact page</Link>).
              </>
            )}
          </p>
        </>
      )}

      <h2>Where the facts come from</h2>
      <ul>
        <li>
          Periodic table: atomic weights and electron configurations from NIST (US National Institute of Standards and
          Technology); the periodic-table page names the exact databases.
        </li>
        <li>Molecule pages: formulas, molar masses and melting/boiling points checked against PubChem (NCBI).</li>
        <li>
          3D models: glucose, caffeine, the DNA base pair, the dipeptide, capsaicin, dopamine, adrenaline, aspirin and
          serotonin use the computed 3D conformers published by PubChem (NCBI); the other five (water, methane, ethanol,
          buckminsterfullerene and heme) are hand-built illustrations, not measured structures.
        </li>
      </ul>
    </LegalPage>
  );
}
