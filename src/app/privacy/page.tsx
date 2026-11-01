import Link from "next/link";
import { LegalPage, Owner } from "@/components/legal/LegalPage";
import { SITE_OWNER } from "@/lib/legal/site-owner";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/privacy");

/**
 * DRAFT privacy policy (D6). Every statement about data is taken from what the code does — the source of each one is
 * listed in docs/seo/TRUST_PAGES.md. What the code does not decide (legal bases, host log retention, the Gemini
 * plan's terms, deletion) comes from SITE_OWNER and is a placeholder until the owner and a lawyer fill it in.
 */
export default function PrivacyPage() {
  const o = SITE_OWNER;
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what Molecule Architecture Studio stores about you, which other services receive it, and
        why. The site is operated by <Owner value={o.legalName} /> (<Owner value={o.country} />). Questions and requests:{" "}
        <Owner value={o.contactEmail} />.
      </p>

      <h2>Browsing without an account</h2>
      <p>
        You can use the explorer, the atomic models, the periodic table, the molecule pages and the pricing page without
        an account. The site uses no analytics and no advertising cookies. Your browser stores your choice of theme and
        language on your device (local storage keys <code>moleculestudio-theme</code> and{" "}
        <code>moleculestudio-locale</code>); they are not sent to us.
      </p>

      <h2>When you create an account</h2>
      <ul>
        <li>
          With email and password we store your email address, your password as a one-way bcrypt hash (never the password
          itself), your first name, last name and date of birth as you enter them, the IP address you signed up from,
          whether your email address is verified, and when the account was created.
        </li>
        <li>
          With Google sign-in we store your Google account identifier and the email address Google confirms. Google does
          not give us your name or date of birth: those profile fields are filled with generated placeholder values,
          which you can change on your profile page.
        </li>
        <li>
          To verify your email address and to reset a password we email you a one-time link. We keep only a hash of the
          link&apos;s token; verification links expire after 24 hours, password-reset links after 1 hour.
        </li>
      </ul>

      <h2>Signing in</h2>
      <p>
        Signing in sets one cookie, <code>session_token</code>: it is HttpOnly (page scripts cannot read it), sent only to
        this site (SameSite=Strict), Secure on https, and expires with the session (7 days by default). A copy of your profile (name and email) is
        kept in your browser&apos;s local storage to show your name in the menu; signing out removes it. When you sign out
        the session is also revoked on our side until it would have expired.
      </p>

      <h2>Buying credits</h2>
      <p>
        Payments are handled by Lemon Squeezy, the merchant of record: you pay on their checkout page and your card details
        never reach us. To start a checkout we send Lemon Squeezy your email address and your account id. When the payment
        completes, Lemon Squeezy sends us the order; we store that message as received (it contains the order details
        Lemon Squeezy includes, such as the buyer&apos;s email address), the credits added, and a permanent record of every
        purchase, use and refund of credits. Refund notices from Lemon Squeezy are stored the same way. We email you a
        receipt for each purchase. Refunds: <Owner value={o.refundPolicy} />.
      </p>

      <h2>The AI Lab</h2>
      <p>
        When you send a message in the AI Lab, our server sends the conversation (your recent messages and the
        assistant&apos;s replies) to Google&apos;s Gemini API to produce an answer. We do not store your messages in our
        database; we record one credit charge per answer, with a reference number and the time. Error logs can contain
        your account id and that reference number, never the text. What Google may do with the messages under the Gemini
        API plan we use: <Owner value={o.geminiDataUse} />.
      </p>
      <p>
        When the assistant suggests a molecule, your browser loads its 3D structure directly from PubChem (run by the US
        National Center for Biotechnology Information), so PubChem receives the molecule&apos;s structure (as a SMILES
        string) and your IP address.
      </p>

      <h2>Email</h2>
      <p>Verification, password-reset and receipt emails are sent through Resend, which receives your email address and the message.</p>

      <h2>Where the data is kept and for how long</h2>
      <ul>
        <li>Hosting: <Owner value={o.hostingProviders} />.</li>
        <li>Server and hosting logs: <Owner value={o.logRetention} />.</li>
        <li>
          Your account data is kept while your account exists. Records of credit purchases, use and refunds cannot be
          deleted: the database refuses it, because they are the accounting record of what was paid for.
        </li>
        <li>Deleting your account: <Owner value={o.accountDeletion} />.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        The rights you have over your data (access, correction, deletion, objection, complaint to a supervisory
        authority) and the legal basis for each use above depend on where you and the operator are; this section needs
        legal review. Governing law: <Owner value={o.governingLaw} />. To make a request, write to{" "}
        <Owner value={o.contactEmail} />.
      </p>

      <p>
        See also the <Link href="/terms" className="underline">terms of use</Link>.
      </p>
    </LegalPage>
  );
}
