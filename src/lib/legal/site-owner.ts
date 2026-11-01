/**
 * Who publishes the site and how to reach them (D6, SEO-10). The trust pages (/about, /contact, /privacy, /terms)
 * and the Organization JSON-LD read ONLY from here.
 *
 * Every value that has to come from the owner (and a lawyer) is a placeholder: a string starting with
 * PLACEHOLDER_PREFIX. While any placeholder remains:
 *  - the trust pages show a "Draft — needs legal review" notice and the placeholder text in brackets,
 *  - they are noindex and left out of the sitemap,
 *  - no Organization JSON-LD is emitted,
 *  - `npm run check:launch-content` fails and names each one.
 * Fill a value by replacing the whole string. Nothing here is a secret: it is published on the pages.
 */
export const PLACEHOLDER_PREFIX = "TODO(owner):";

export interface SiteOwner {
  /** Legal name of the person or company that operates the site. */
  legalName: string;
  /** Country (and region, if relevant) whose law the operator is under. */
  country: string;
  /** Postal address for legal notices. */
  postalAddress: string;
  /** Address people can write to (support and privacy requests). */
  contactEmail: string;
  /** Governing law and courts for the terms. */
  governingLaw: string;
  /** Refund policy for credit packs, in the owner's words (Lemon Squeezy is the merchant of record). */
  refundPolicy: string;
  /** Where the site and its database are hosted (names of the providers actually used). */
  hostingProviders: string;
  /** How long server/host logs are kept (decided by the hosting plans, not by the code). */
  logRetention: string;
  /** What Google may do with AI Lab prompts under the Gemini API plan actually used (paid vs free tier terms differ). */
  geminiDataUse: string;
  /** How a user can have their account deleted (the code has no self-service deletion). */
  accountDeletion: string;
  /**
   * Where the daily `db:purge-signup-ips` job runs and what alerts you when it does not (a heartbeat monitor). The privacy
   * policy says the signup address is cleared after 90 days ONLY once this is filled in: the sentence is true only while
   * the job runs. Filling it in is the owner's statement that the job is scheduled and monitored (LAUNCH_CHECKLIST §5.1).
   */
  signupIpPurgeJob: string;
  /**
   * Where the daily `db:process-deletions` job runs and what alerts you when it does not. The privacy policy describes self-service
   * deletion as working ONLY once this is filled in (without the job nobody is ever anonymised). LAUNCH_CHECKLIST §5.1.
   */
  accountDeletionJob: string;
  /**
   * The owner's decision on the re-registration guard (a 12-month keyed hash of a deleted account's e-mail, to stop the signup bonus being
   * collected twice). Start the value with "enabled" or "disabled" (it must match EMAIL_TOMBSTONE_GUARD on the service). The privacy text
   * mentions the guard only when it starts with "enabled". Needs legal review either way.
   */
  emailTombstoneGuard: string;
  /** Effective date of the privacy policy and terms (YYYY-MM-DD). */
  effectiveDate: string;
}

export const SITE_OWNER: SiteOwner = {
  legalName: `${PLACEHOLDER_PREFIX} legal name of the operator (person or company)`,
  country: `${PLACEHOLDER_PREFIX} country of the operator`,
  postalAddress: `${PLACEHOLDER_PREFIX} postal address for legal notices`,
  contactEmail: `${PLACEHOLDER_PREFIX} contact email address`,
  governingLaw: `${PLACEHOLDER_PREFIX} governing law and courts`,
  refundPolicy: `${PLACEHOLDER_PREFIX} refund policy for credit packs`,
  hostingProviders: `${PLACEHOLDER_PREFIX} hosting providers actually used (web app, API, database)`,
  logRetention: `${PLACEHOLDER_PREFIX} how long hosting logs are kept`,
  geminiDataUse: `${PLACEHOLDER_PREFIX} what Google may do with prompts under the Gemini API plan used`,
  accountDeletion: `${PLACEHOLDER_PREFIX} how to request account deletion and what is kept (e.g. purchase records)`,
  signupIpPurgeJob: `${PLACEHOLDER_PREFIX} where the daily signup-address purge job runs and which heartbeat monitor alerts if it does not`,
  accountDeletionJob: `${PLACEHOLDER_PREFIX} where the daily account-deletion job runs and which heartbeat monitor alerts if it does not`,
  emailTombstoneGuard: `${PLACEHOLDER_PREFIX} "enabled" or "disabled" (same as EMAIL_TOMBSTONE_GUARD) after legal review of the 12-month e-mail hash`,
  effectiveDate: `${PLACEHOLDER_PREFIX} effective date`,
};

export const isPlaceholder = (value: string): boolean => value.trim().startsWith(PLACEHOLDER_PREFIX);

/** Names of the fields that are still placeholders (empty when the owner has filled everything in). */
export function remainingPlaceholders(owner: SiteOwner = SITE_OWNER): (keyof SiteOwner)[] {
  return (Object.keys(owner) as (keyof SiteOwner)[]).filter((key) => isPlaceholder(owner[key]) || !owner[key].trim());
}

/** True while the trust pages are drafts (any placeholder left). */
export const TRUST_PAGES_ARE_DRAFTS = remainingPlaceholders().length > 0;

/** For display: a placeholder renders as "[to be provided: …]", a real value as itself. */
export function display(value: string): string {
  return isPlaceholder(value) ? `[to be provided: ${value.trim().slice(PLACEHOLDER_PREFIX.length).trim()}]` : value;
}
