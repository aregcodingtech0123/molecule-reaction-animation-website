/**
 * Who publishes the site and how to reach them (D6, SEO-10). The trust pages (/about, /contact, /privacy, /terms) and the
 * Organization JSON-LD read ONLY from here, and only from environment variables of the WEB host (the Next.js app):
 *
 *   SITE_OWNER_<NAME>   server-side, read on every request, never NEXT_PUBLIC_* (nothing is baked into the build).
 *
 * Rules (tested in tests/unit/legal/ and tests/api/launch-content.test.ts):
 *  - An unset or empty variable means "nothing to show": the field, and any sentence or section that depends on it, is
 *    left out. No placeholder text is ever rendered.
 *  - A value that fails its format check (e-mail shape, YYYY-MM-DD date, ...) counts as not set, so a typo can neither show
 *    up on a page nor open the gate.
 *  - REQUIRED fields gate the launch: while any is empty or invalid the four pages stay `noindex`, are out of the sitemap and
 *    no Organization JSON-LD is emitted, and `npm run check:launch-content` exits 1 naming the variables.
 *  - Values are plain text. They are rendered as React text (escaped), never as HTML. Long values: a blank line starts a new
 *    paragraph; a single line break stays a line break; write `\n` where the host's dashboard cannot hold a real newline.
 *  - SITE_OWNER_LEGAL_REVIEWED=true removes the "Draft - needs legal review" notice. It does not make pages indexable
 *    (the required fields do) and no other variable depends on it.
 * Nothing here is a secret: every value is published on a page.
 */
export type Env = Record<string, string | undefined>;

/** How a value is validated and rendered. */
export type FieldKind =
  | "line" //  one line (names, numbers)
  | "text" //  free text, paragraphs and line breaks allowed
  | "email"
  | "phone"
  | "date" //   YYYY-MM-DD
  | "guard"; // "enabled ..." or "disabled ..." (a decision, never displayed)

export interface FieldDef {
  key: string;
  /** The environment variable on the web host. */
  env: string;
  kind: FieldKind;
  /** Required fields gate the launch (indexing of the trust pages, check:launch-content). */
  required: boolean;
  /** Longest accepted value (characters, after normalisation); longer counts as invalid. */
  maxLength: number;
  /** What it is used for - shown by check:launch-content next to the variable name. */
  use: string;
}

export const OWNER_FIELDS = [
  { key: "legalName", env: "SITE_OWNER_LEGAL_NAME", kind: "line", required: true, maxLength: 200, use: "who operates the site (About, Contact, Privacy, Terms, Organization JSON-LD)" },
  { key: "country", env: "SITE_OWNER_COUNTRY", kind: "line", required: true, maxLength: 100, use: "country of the operator (About, Contact, Privacy, Terms)" },
  { key: "registrationNumber", env: "SITE_OWNER_REGISTRATION_NUMBER", kind: "line", required: false, maxLength: 100, use: "company registration or tax number, shown only if you give one (About, Contact, Privacy)" },
  { key: "postalAddress", env: "SITE_OWNER_POSTAL_ADDRESS", kind: "text", required: true, maxLength: 500, use: "postal address for legal notices (Contact, Privacy, Terms, Organization JSON-LD)" },
  { key: "contactEmail", env: "SITE_OWNER_CONTACT_EMAIL", kind: "email", required: true, maxLength: 254, use: "general contact and the address for privacy requests unless a privacy address is set (all four pages)" },
  { key: "supportEmail", env: "SITE_OWNER_SUPPORT_EMAIL", kind: "email", required: false, maxLength: 254, use: "separate support address, shown only if you give one (Contact)" },
  { key: "privacyEmail", env: "SITE_OWNER_PRIVACY_EMAIL", kind: "email", required: false, maxLength: 254, use: "address for privacy requests (data protection contact), shown only if you give one (Contact, Privacy)" },
  { key: "phone", env: "SITE_OWNER_PHONE", kind: "phone", required: false, maxLength: 30, use: "telephone number, shown only if you give one (Contact)" },
  { key: "governingLaw", env: "SITE_OWNER_GOVERNING_LAW", kind: "text", required: true, maxLength: 1500, use: "governing law and courts (Terms, Privacy)" },
  { key: "refundPolicy", env: "SITE_OWNER_REFUND_POLICY", kind: "text", required: true, maxLength: 4000, use: "refund policy for credit packs, text or a single https URL (Terms, Privacy)" },
  { key: "hostingProviders", env: "SITE_OWNER_HOSTING_PROVIDERS", kind: "text", required: true, maxLength: 1000, use: "hosting providers actually used (Privacy)" },
  { key: "logRetention", env: "SITE_OWNER_LOG_RETENTION", kind: "text", required: true, maxLength: 1000, use: "how long hosting logs are kept (Privacy)" },
  { key: "geminiDataUse", env: "SITE_OWNER_GEMINI_DATA_USE", kind: "text", required: true, maxLength: 2000, use: "what Google may do with AI Lab prompts under the Gemini API plan used (Privacy)" },
  { key: "accountDeletion", env: "SITE_OWNER_ACCOUNT_DELETION", kind: "text", required: true, maxLength: 2000, use: "how to ask for account deletion by e-mail and what is kept (Privacy, Terms)" },
  { key: "signupIpPurgeJob", env: "SITE_OWNER_SIGNUP_IP_PURGE_JOB", kind: "text", required: true, maxLength: 1000, use: "your statement that the daily db:purge-signup-ips job runs and is monitored; lets the policy state the 90-day clearing (never displayed)" },
  { key: "accountDeletionJob", env: "SITE_OWNER_ACCOUNT_DELETION_JOB", kind: "text", required: true, maxLength: 1000, use: "your statement that the daily db:process-deletions job runs and is monitored; lets the policy describe self-service deletion as active (never displayed)" },
  { key: "emailTombstoneGuard", env: "SITE_OWNER_EMAIL_TOMBSTONE_GUARD", kind: "guard", required: true, maxLength: 1000, use: "your decision on the 12-month e-mail hash: starts with enabled or disabled, matching EMAIL_TOMBSTONE_GUARD on the API service (never displayed)" },
  { key: "effectiveDate", env: "SITE_OWNER_EFFECTIVE_DATE", kind: "date", required: true, maxLength: 10, use: "effective date of the privacy policy and terms, YYYY-MM-DD (all four pages)" },
  { key: "lastUpdated", env: "SITE_OWNER_LAST_UPDATED", kind: "date", required: false, maxLength: 10, use: "date the pages were last changed, YYYY-MM-DD, shown only if you give one" },
] as const satisfies readonly FieldDef[];

/** The switch for the draft notice (not a text field). */
export const LEGAL_REVIEWED_ENV = "SITE_OWNER_LEGAL_REVIEWED";

export type OwnerKey = (typeof OWNER_FIELDS)[number]["key"];
/** One string per field; "" means not set (or invalid). */
export type SiteOwner = Record<OwnerKey, string>;

export const REQUIRED_FIELDS: readonly FieldDef[] = OWNER_FIELDS.filter((f) => f.required);

const EMAIL = /^[^\s@<>"'()[\]\\,;:]+@[^\s@<>"'()[\]\\,;:]+\.[A-Za-z]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ().\-/]{5,28}[0-9]$/;
const GUARD = /^(enabled|disabled)(?![A-Za-z0-9_])/i;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Normalise a raw value: real and literal `\n` line breaks, no control characters, trimmed lines, at most one blank line in a row.
 * `line` values lose their line breaks entirely.
 */
export function normalizeOwnerValue(raw: string | undefined, kind: FieldKind): string {
  if (!raw) return "";
  const lines = raw
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim());
  if (kind !== "text") return lines.filter(Boolean).join(" ").trim();
  const out: string[] = [];
  for (const line of lines) if (line || out.at(-1)) out.push(line);
  return out.join("\n").trim();
}

/** Is a (normalised, non-empty) value acceptable for its kind? */
export function isValidOwnerValue(value: string, field: FieldDef): boolean {
  if (value.length > field.maxLength) return false;
  switch (field.kind) {
    case "email":
      return EMAIL.test(value);
    case "phone":
      return PHONE.test(value);
    case "date":
      return isRealDate(value);
    case "guard":
      return GUARD.test(value);
    default:
      return true;
  }
}

/** Why a set value is rejected (names the rule, never the value). */
export function invalidReason(field: FieldDef): string {
  switch (field.kind) {
    case "email":
      return "is not a single e-mail address (name@domain.tld) or is longer than " + field.maxLength + " characters";
    case "phone":
      return "is not a telephone number (digits, spaces, + ( ) . - /; 7 to 30 characters)";
    case "date":
      return "is not a real date in the form YYYY-MM-DD";
    case "guard":
      return 'must start with "enabled" or "disabled"';
    default:
      return `is longer than ${field.maxLength} characters`;
  }
}

export interface OwnerStatus {
  /** Valid values only; "" for every field that is unset or invalid. */
  owner: SiteOwner;
  /** Required variables that are unset or empty. */
  empty: FieldDef[];
  /** Variables (required or optional) that are set but fail their format or length check. */
  invalid: FieldDef[];
  /** SITE_OWNER_LEGAL_REVIEWED is exactly "true" (case-insensitive). */
  legalReviewed: boolean;
}

/** Read every SITE_OWNER_* variable from `env` (default: this process, on every call). */
export function readSiteOwner(env: Env = process.env): OwnerStatus {
  const owner = {} as SiteOwner;
  const empty: FieldDef[] = [];
  const invalid: FieldDef[] = [];
  for (const field of OWNER_FIELDS) {
    const value = normalizeOwnerValue(env[field.env], field.kind);
    if (!value) {
      owner[field.key] = "";
      if (field.required) empty.push(field);
    } else if (isValidOwnerValue(value, field)) {
      owner[field.key] = value;
    } else {
      owner[field.key] = "";
      invalid.push(field);
    }
  }
  return { owner, empty, invalid, legalReviewed: (env[LEGAL_REVIEWED_ENV] ?? "").trim().toLowerCase() === "true" };
}

export const getSiteOwner = (env: Env = process.env): SiteOwner => readSiteOwner(env).owner;

/** Variables (by name) that still block the launch: required and empty, or set but invalid. */
export function blockingFields(status: OwnerStatus): FieldDef[] {
  const bad = new Set<string>([...status.empty, ...status.invalid.filter((f) => f.required)].map((f) => f.env));
  return REQUIRED_FIELDS.filter((f) => bad.has(f.env));
}

/** True once every required field is set and valid: the trust pages may then be indexed. */
export const trustPagesReady = (env: Env = process.env): boolean => blockingFields(readSiteOwner(env)).length === 0;

/** True while the "Draft - needs legal review" notice is shown. */
export const showDraftNotice = (env: Env = process.env): boolean => !readSiteOwner(env).legalReviewed;

/** The declared decision on the e-mail hash: true only for a value starting with "enabled". */
export const tombstoneGuardEnabled = (owner: SiteOwner): boolean => /^enabled(?![A-Za-z0-9_])/i.test(owner.emailTombstoneGuard);

/** Paragraphs (blank-line separated) of lines (single line breaks) of a text value. */
export function paragraphsOf(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.split("\n").filter(Boolean))
    .filter((p) => p.length > 0);
}

/** A value that is exactly one https URL (the refund policy may be a link); anything else is text. */
export function singleHttpsUrl(text: string): string | null {
  if (!/^https:\/\/[^\s<>"'`]+$/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The address for privacy requests: the dedicated one if given, else the general contact address ("" if neither). */
export const privacyContact = (owner: SiteOwner): string => owner.privacyEmail || owner.contactEmail;
