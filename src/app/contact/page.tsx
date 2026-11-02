import Link from "next/link";
import { LegalPage, OwnerEmail, OwnerLines } from "@/components/legal/LegalPage";
import { getSiteOwner } from "@/lib/legal/site-owner";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/contact");
// The operator's details come from SITE_OWNER_* variables, read on every request.
export const dynamic = "force-dynamic";

/** Contact page (D6). No form: only the details the owner has given are listed. */
export default function ContactPage() {
  const o = getSiteOwner();
  const operator = [o.legalName, o.country].filter(Boolean).join(", ");
  const hasList = o.contactEmail || o.supportEmail || o.privacyEmail || o.phone || o.postalAddress || operator || o.registrationNumber;
  return (
    <LegalPage title="Contact">
      {hasList && (
        <ul>
          {o.contactEmail && (
            <li>
              Email: <OwnerEmail value={o.contactEmail} />
            </li>
          )}
          {o.supportEmail && (
            <li>
              Support: <OwnerEmail value={o.supportEmail} />
            </li>
          )}
          {o.privacyEmail && (
            <li>
              Privacy requests: <OwnerEmail value={o.privacyEmail} />
            </li>
          )}
          {o.phone && <li>Telephone: {o.phone}</li>}
          {o.postalAddress && (
            <li>
              Postal address for legal notices: <OwnerLines value={o.postalAddress} />
            </li>
          )}
          {operator && <li>Operator: {operator}</li>}
          {o.registrationNumber && <li>Registration number: {o.registrationNumber}</li>}
        </ul>
      )}
      <p>
        Payments and refunds are processed by Lemon Squeezy, the merchant of record; questions about a charge can also go
        to them. How we handle your data: <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
