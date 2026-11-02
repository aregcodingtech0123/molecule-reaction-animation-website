import Link from "next/link";
import { LegalPage, OwnerBlock, OwnerEmail, OwnerLines } from "@/components/legal/LegalPage";
import { getSiteOwner, privacyContact, tombstoneGuardEnabled } from "@/lib/legal/site-owner";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/privacy");
// The operator's details and the statements about scheduled jobs come from SITE_OWNER_* variables, read on every request.
export const dynamic = "force-dynamic";

/**
 * Privacy policy (D6). Every statement about data is taken from what the code does - the source of each one is listed in
 * docs/seo/TRUST_PAGES.md. What the code does not decide (host log retention, the Gemini plan's terms, manual deletion) comes
 * from SITE_OWNER_* variables and is shown only when set. A practice that depends on a scheduled job is described as active
 * only when the owner has declared the job (SITE_OWNER_SIGNUP_IP_PURGE_JOB, SITE_OWNER_ACCOUNT_DELETION_JOB,
 * SITE_OWNER_EMAIL_TOMBSTONE_GUARD starting with "enabled"). No legal conclusion is drawn here; see docs/seo/LEGAL_REVIEW_QUESTIONS.md.
 */
export default function PrivacyPage() {
  const o = getSiteOwner();
  const contact = privacyContact(o);
  const operator = [o.legalName, o.country].filter(Boolean).join(", ");
  const purgeScheduled = o.signupIpPurgeJob !== "";
  const deletionLive = o.accountDeletionJob !== "";
  const tombstoneEnabled = tombstoneGuardEnabled(o);
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what Molecule Architecture Studio stores about you, which other services receive it, and why.
      </p>

      {(operator || o.postalAddress || contact) && (
        <>
          <h2>Who is responsible for this site</h2>
          <ul>
            {operator && (
              <li>
                Operator: {operator}
                {o.registrationNumber ? ` (registration number ${o.registrationNumber})` : ""}
              </li>
            )}
            {o.postalAddress && (
              <li>
                Postal address: <OwnerLines value={o.postalAddress} />
              </li>
            )}
            {contact && (
              <li>
                Questions and requests about your data: <OwnerEmail value={contact} />
              </li>
            )}
          </ul>
        </>
      )}

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
          itself), your first name, last name and date of birth as you enter them, the IP address you signed up from
          {purgeScheduled
            ? " (cleared automatically once the account is 90 days old)"
            : " (kept with the account for now; an automatic clearing after 90 days is planned and will be stated here once it runs)"}
          , whether your email address is verified, and when the
          account was created.
        </li>
        <li>
          With Google sign-in we store your Google account identifier and the email address Google confirms. Google does
          not give us your name or date of birth, and we do not invent any: those profile fields stay empty until you
          enter them on your profile page, where you can also remove them again.
        </li>
        <li>
          To verify your email address and to reset a password we email you a one-time link. We keep only a hash of the
          link&apos;s token; verification links expire after 24 hours, password-reset links after 1 hour.
        </li>
        <li>New accounts receive 10 credits once.</li>
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
        Lemon Squeezy includes, such as the buyer&apos;s email address; that stored copy is cleared 30 days after the order was
        processed), the credits added, and a permanent record of every
        purchase, use and refund of credits. Refund notices from Lemon Squeezy are stored the same way. We email you a
        receipt for each purchase. Our refund terms are in the <Link href="/terms" className="underline">terms of use</Link>.
      </p>

      <h2>The AI Lab</h2>
      <p>
        When you send a message in the AI Lab, our server sends the conversation (your recent messages and the
        assistant&apos;s replies) to Google&apos;s Gemini API to produce an answer. We do not store your messages in our
        database; we record one credit charge per answer, with a reference number and the time. Error logs can contain
        your account id and that reference number, never the text.
      </p>
      {o.geminiDataUse && (
        <>
          <p>What Google may do with the messages under the Gemini API plan we use:</p>
          <OwnerBlock value={o.geminiDataUse} />
        </>
      )}
      <p>
        When the assistant suggests a molecule, your browser loads its 3D structure directly from PubChem (run by the US
        National Center for Biotechnology Information), so PubChem receives the molecule&apos;s structure (as a SMILES
        string) and your IP address.
      </p>

      <h2>Email</h2>
      <p>Verification, password-reset and receipt emails are sent through Resend, which receives your email address and the message.</p>

      <h2>Where the data is kept and for how long</h2>
      <ul>
        {o.hostingProviders && (
          <li>
            Hosting: <OwnerLines value={o.hostingProviders} />
          </li>
        )}
        {o.logRetention && (
          <li>
            Server and hosting logs: <OwnerLines value={o.logRetention} />
          </li>
        )}
        <li>
          Your account data is kept while your account exists. Records of credit purchases, use and refunds cannot be
          deleted: the database refuses it, because they are the accounting record of what was paid for.
        </li>
        <li>
          Getting a copy of your data: on your profile page, &ldquo;Download my data&rdquo; gives you one JSON file with
          your profile, sign-in methods, credit balance, every credit transaction, checkout orders and AI credit
          reservations, after you confirm with your password (or with Google again). It never contains your password or
          any token.
        </li>
        {deletionLive ? (
          <li>
            Deleting your account: on your profile page, &ldquo;Delete my account&rdquo; (you confirm with your password, or with
            Google again). Deletion takes effect after a 14-day grace period, during which you can sign in and cancel. When it takes
            effect, your email address, name, date of birth, sign-in methods and signup address are removed and the account can no
            longer be used; your remaining credits are permanently lost and cannot be restored. The records of credit purchases, use and
            refunds are kept as the accounting record, without your name or email address.
            {contact && (
              <>
                {" "}
                You can also write to <OwnerEmail value={contact} />.
              </>
            )}
            {o.accountDeletion && <OwnerBlock value={o.accountDeletion} />}
          </li>
        ) : (
          o.accountDeletion && (
            <li>
              Deleting your account: self-service deletion is not active yet.
              <OwnerBlock value={o.accountDeletion} />
            </li>
          )
        )}
        {tombstoneEnabled && (
          <li>
            So that the one-time signup bonus cannot be collected again by deleting an account and registering the same address,
            we keep a one-way, keyed hash of the email address of a deleted account for 12 months, then delete it. The hash cannot
            be turned back into the address without our secret key; it is kept only for this purpose.
          </li>
        )}
      </ul>

      <h2>Who receives your data</h2>
      <ul>
        <li>Google: sign-in with Google (the identity token is checked with Google) and the AI Lab conversation (Gemini).</li>
        <li>Lemon Squeezy: your email address and account id when you start a checkout, and the payment itself.</li>
        <li>Resend: your email address and the message, for verification, password-reset and receipt emails.</li>
        <li>PubChem: the structure of a suggested molecule and your IP address, from your browser.</li>
        {o.hostingProviders && <li>Our hosting providers, listed above, process the data the site and its database hold.</li>}
      </ul>

      <h2>Your requests</h2>
      <p>
        You can download your data and ask for your account to be deleted on your profile page.
        {contact && (
          <>
            {" "}
            For anything else about your data, write to <OwnerEmail value={contact} />.
          </>
        )}{" "}
        See also the <Link href="/terms" className="underline">terms of use</Link>.
      </p>
    </LegalPage>
  );
}
