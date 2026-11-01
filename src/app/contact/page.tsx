import Link from "next/link";
import { LegalPage, Owner } from "@/components/legal/LegalPage";
import { SITE_OWNER } from "@/lib/legal/site-owner";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/contact");

/** DRAFT contact page (D6). No form: email and postal address from the owner config. */
export default function ContactPage() {
  const o = SITE_OWNER;
  return (
    <LegalPage title="Contact">
      <ul>
        <li>
          Email (support, account and privacy requests): <Owner value={o.contactEmail} />
        </li>
        <li>
          Postal address for legal notices: <Owner value={o.postalAddress} />
        </li>
        <li>
          Operator: <Owner value={o.legalName} />, <Owner value={o.country} />
        </li>
      </ul>
      <p>
        Payments and refunds are processed by Lemon Squeezy, the merchant of record; questions about a charge can also go
        to them. How we handle your data: <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
