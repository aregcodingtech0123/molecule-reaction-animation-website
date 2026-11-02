/**
 * The four trust pages render only what the SITE_OWNER_* variables give them: nothing placeholder-like when they are empty, every value
 * when they are set, each dependent section only with its variable, values as text (never HTML), the draft notice only until
 * SITE_OWNER_LEGAL_REVIEWED=true, and the numbers they state are the ones in the code.
 */
import fs from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AboutPage from "@/app/about/page";
import ContactPage from "@/app/contact/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { OWNER_FIELDS } from "@/lib/legal/site-owner";
import { FULL_OWNER_ENV, ownerEnvWithout } from "../../support/site-owner-env";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllEnvs());

const PAGES = { about: AboutPage, contact: ContactPage, privacy: PrivacyPage, terms: TermsPage } as const;
type PageName = keyof typeof PAGES;

function html(page: PageName, env: Record<string, string> = {}): string {
  for (const f of OWNER_FIELDS) vi.stubEnv(f.env, "");
  vi.stubEnv("SITE_OWNER_LEGAL_REVIEWED", "");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return renderToString(PAGES[page]());
}
const textOf = (h: string) => h.replace(/<\/(p|li|h1|h2|ul|main|div)>/g, " ").replace(/<br\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("every variable empty", () => {
  it.each(Object.keys(PAGES) as PageName[])("%s: no placeholder-like text, no empty label, no mailto, no dates", (page) => {
    const h = html(page);
    const t = textOf(h);
    expect(h).not.toMatch(/TODO|to be provided|\[[^\]]*(provided|owner)[^\]]*\]|placeholder|undefined|\bnull\b|NaN|\[object/i);
    expect(h).not.toContain("mailto:");
    expect(t).not.toMatch(/Effective date|Last updated/);
    // no label left dangling with nothing after it
    expect(t).not.toMatch(/(Email|Support|Telephone|Postal address|Operator|Registration number|Hosting|Server and hosting logs|Privacy requests): ?(\.|$| \()/);
    expect(t).not.toMatch(/, ,|\( ?\)|\(\)|operated by \./);
    expect(t).toContain("Draft — needs legal review.");
    expect(t).toContain("This page is available in English only.");
  });

  it("the privacy text keeps the true statements and drops every section that depends on a missing value", () => {
    const t = textOf(html("privacy"));
    expect(t).toContain("The site uses no analytics and no advertising cookies");
    expect(t).not.toContain("Who is responsible for this site");
    expect(t).not.toContain("What Google may do with the messages");
    expect(t).not.toMatch(/Hosting:|Server and hosting logs:|Our hosting providers/);
    expect(t).not.toContain("Deleting your account");
    expect(t).not.toContain("keyed hash");
    expect(t).not.toContain("For anything else about your data, write to");
  });

  it("the terms keep the credit packs and drop refunds, deletion and governing law", () => {
    const t = textOf(html("terms"));
    expect(t).toContain("Starter Pack: 50 credits for $5 (USD)");
    expect(t).not.toMatch(/Refunds|Governing law|Deleting your account/);
    expect(t).toContain("These terms apply to Molecule Architecture Studio.");
  });

  it("contact and about have no operator list or block", () => {
    expect(html("contact")).not.toContain("<ul");
    expect(textOf(html("about"))).not.toContain("Who runs it");
  });
});

describe("every variable set", () => {
  it("contact lists each detail; the address keeps its line break; e-mail addresses are links", () => {
    const h = html("contact", FULL_OWNER_ENV);
    const t = textOf(h);
    expect(t).toContain("Email: hello@studio.example");
    expect(t).toContain("Support: support@studio.example");
    expect(t).toContain("Privacy requests: privacy@studio.example");
    expect(t).toContain("Telephone: +00 000 000 0000");
    expect(t).toContain("Operator: Example Studio Ltd, Exampleland");
    expect(t).toContain("Registration number: REG-000000");
    expect(h).toContain("1 Example Street<br/>Example City 00000");
    expect(h).toContain('href="mailto:hello@studio.example"');
  });

  it("about names the operator and the contact address", () => {
    const t = textOf(html("about", FULL_OWNER_ENV));
    expect(t).toContain("Example Studio Ltd, Exampleland (registration number REG-000000)");
    expect(t).toContain("Contact: hello@studio.example");
  });

  it("privacy shows the operator block, the privacy address, hosting, logs, the Gemini plan, deletion and the dates", () => {
    const h = html("privacy", FULL_OWNER_ENV);
    const t = textOf(h);
    expect(t).toContain("Operator: Example Studio Ltd, Exampleland (registration number REG-000000)");
    expect(t).toContain("Postal address: 1 Example Street Example City 00000");
    expect(t).toContain("Questions and requests about your data: privacy@studio.example");
    expect(t).toContain("Hosting: Example Cloud (web), Example API Host (API), Example DB (database)");
    expect(t).toContain("Server and hosting logs: Hosting logs are kept for 7 days.");
    expect(t).toContain("What Google may do with the messages under the Gemini API plan we use:");
    expect(t).toContain("Under the paid plan Google does not use prompts to train its models.");
    expect(t).toContain("Write to us from your account address and we delete the account within 30 days.");
    expect(t).toContain("cleared automatically once the account is 90 days old");
    expect(t).toContain("keyed hash");
    expect(t).toContain("Effective date: 2026-01-01");
    expect(t).toContain("Last updated: 2026-02-01");
    expect(t).not.toContain("Draft — needs legal review.");
    expect(t).not.toContain("Example Cron"); // the job declarations are never printed
    expect(t).not.toContain("decision recorded");
  });

  it("terms show the refund policy as paragraphs, the deletion route and the governing law", () => {
    const h = html("terms", FULL_OWNER_ENV);
    expect(h).toContain("<p>Refunds within 14 days if no credits were used.</p><p>Contact us with your order number.</p>");
    expect(textOf(h)).toContain("Governing law The laws of Exampleland; the courts of Example City.");
    expect(textOf(h)).toContain("operated by Example Studio Ltd, Exampleland");
  });

  it("a refund policy that is a single https URL becomes a link", () => {
    const h = html("terms", { ...FULL_OWNER_ENV, SITE_OWNER_REFUND_POLICY: "https://studio.example/refunds" });
    expect(h).toContain('<a href="https://studio.example/refunds" rel="noopener noreferrer" class="underline">https://studio.example/refunds</a>');
  });
});

describe("each dependent section toggles with its variable", () => {
  const cases: Array<[string, PageName, string, RegExp]> = [
    ["legal name + country (operator line)", "contact", "SITE_OWNER_LEGAL_NAME", /Operator: Example Studio Ltd/],
    ["registration number", "contact", "SITE_OWNER_REGISTRATION_NUMBER", /Registration number/],
    ["contact e-mail", "contact", "SITE_OWNER_CONTACT_EMAIL", /Email: hello@/],
    ["support e-mail", "contact", "SITE_OWNER_SUPPORT_EMAIL", /Support: /],
    ["privacy e-mail", "contact", "SITE_OWNER_PRIVACY_EMAIL", /Privacy requests: /],
    ["phone", "contact", "SITE_OWNER_PHONE", /Telephone: /],
    ["postal address", "contact", "SITE_OWNER_POSTAL_ADDRESS", /Postal address for legal notices/],
    ["hosting providers", "privacy", "SITE_OWNER_HOSTING_PROVIDERS", /Hosting: Example Cloud/],
    ["hosting providers (recipients list)", "privacy", "SITE_OWNER_HOSTING_PROVIDERS", /Our hosting providers, listed above/],
    ["log retention", "privacy", "SITE_OWNER_LOG_RETENTION", /Server and hosting logs: /],
    ["Gemini data use", "privacy", "SITE_OWNER_GEMINI_DATA_USE", /What Google may do with the messages/],
    ["manual deletion route", "privacy", "SITE_OWNER_ACCOUNT_DELETION", /we delete the account within 30 days/],
    ["deletion job (self-service paragraph)", "privacy", "SITE_OWNER_ACCOUNT_DELETION_JOB", /Delete my account/],
    ["purge job (90-day clearing)", "privacy", "SITE_OWNER_SIGNUP_IP_PURGE_JOB", /cleared automatically once the account is 90 days old/],
    ["e-mail hash decision (12-month paragraph)", "privacy", "SITE_OWNER_EMAIL_TOMBSTONE_GUARD", /keyed hash/],
    ["refund policy", "terms", "SITE_OWNER_REFUND_POLICY", /Refunds Refunds within 14 days/],
    ["governing law", "terms", "SITE_OWNER_GOVERNING_LAW", /Governing law The laws of Exampleland/],
    ["manual deletion route (terms)", "terms", "SITE_OWNER_ACCOUNT_DELETION", /Deleting your account:/],
    ["effective date", "terms", "SITE_OWNER_EFFECTIVE_DATE", /Effective date: 2026-01-01/],
    ["last-updated date", "terms", "SITE_OWNER_LAST_UPDATED", /Last updated: 2026-02-01/],
  ];
  it.each(cases)("%s", (_label, page, variable, pattern) => {
    expect(textOf(html(page, FULL_OWNER_ENV)), `with ${variable}`).toMatch(pattern);
    expect(textOf(html(page, ownerEnvWithout(variable))), `without ${variable}`).not.toMatch(pattern);
  });

  it("the privacy address falls back to the general contact address, and back to nothing", () => {
    expect(textOf(html("privacy", ownerEnvWithout("SITE_OWNER_PRIVACY_EMAIL")))).toContain("Questions and requests about your data: hello@studio.example");
    expect(textOf(html("privacy", ownerEnvWithout("SITE_OWNER_PRIVACY_EMAIL", "SITE_OWNER_CONTACT_EMAIL")))).not.toContain("Questions and requests about your data");
  });

  it("an invalid value is treated as not set: it is not shown", () => {
    const t = textOf(html("contact", { ...FULL_OWNER_ENV, SITE_OWNER_PHONE: "call me", SITE_OWNER_SUPPORT_EMAIL: "support at studio" }));
    expect(t).not.toMatch(/Telephone|Support:|call me|support at studio/);
  });
});

describe("the draft notice", () => {
  it("is controlled by SITE_OWNER_LEGAL_REVIEWED alone", () => {
    expect(textOf(html("terms", ownerEnvWithout("SITE_OWNER_LEGAL_REVIEWED")))).toContain("Draft — needs legal review.");
    expect(textOf(html("terms", { SITE_OWNER_LEGAL_REVIEWED: "true" }))).not.toContain("Draft — needs legal review.");
    expect(textOf(html("terms", { ...FULL_OWNER_ENV, SITE_OWNER_LEGAL_REVIEWED: "false" }))).toContain("Draft — needs legal review.");
  });
});

describe("values are text, never HTML", () => {
  const hostile = {
    SITE_OWNER_LEGAL_NAME: "<script>alert(1)</script> Ltd",
    SITE_OWNER_COUNTRY: '"><img src=x onerror=alert(2)>',
    SITE_OWNER_POSTAL_ADDRESS: "<b>1 Example Street</b>\n<iframe src=//evil.example></iframe>",
    SITE_OWNER_REFUND_POLICY: "<a href=\"javascript:alert(3)\">refunds</a>\n\n<style>body{display:none}</style>",
    SITE_OWNER_GOVERNING_LAW: "</p><h1>owned</h1>",
    SITE_OWNER_HOSTING_PROVIDERS: "<svg onload=alert(4)>",
    SITE_OWNER_LOG_RETENTION: "&lt;already-escaped&gt;",
  };
  it.each(Object.keys(PAGES) as PageName[])("%s: the markup in a value is escaped, not interpreted", (page) => {
    const h = html(page, { ...FULL_OWNER_ENV, ...hostile });
    for (const needle of ["<script>alert", "<img src=x", "<b>1 Example", "<iframe", 'href="javascript:', "<style>body", "<h1>owned", "<svg onload"]) {
      expect(h, needle).not.toContain(needle);
    }
    expect(h.match(/<h1/g)?.length).toBe(1); // only the page's own heading
  });

  it("escaped forms do appear, and an entity typed by the owner is shown literally (escaped once more)", () => {
    const h = html("privacy", { ...FULL_OWNER_ENV, ...hostile });
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Ltd");
    expect(h).toContain("&lt;b&gt;1 Example Street&lt;/b&gt;<br/>&lt;iframe src=//evil.example&gt;&lt;/iframe&gt;");
    expect(h).toContain("&amp;lt;already-escaped&amp;gt;");
  });

  it("a quote in an e-mail value cannot reach the href: the value is rejected", () => {
    const h = html("contact", { ...FULL_OWNER_ENV, SITE_OWNER_CONTACT_EMAIL: 'a@b.example" onmouseover="x' });
    expect(h).not.toContain("onmouseover");
    expect(h).not.toContain('mailto:a@b.example"');
  });
});

describe("the numbers the pages state are the numbers in the code", () => {
  const root = path.resolve(__dirname, "../../..");
  const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const privacy = () => textOf(html("privacy", FULL_OWNER_ENV));

  it("90 days (purge job default), 30 days (stored order message), 12 months (e-mail hash), 14 days (deletion grace)", () => {
    expect(src("services/auth-billing-service/scripts/purge-signup-ips.mjs")).toMatch(/let days = 90;/);
    expect(src("services/auth-billing-service/src/services/webhookInbox.service.ts")).toContain('PAYLOAD_RETENTION = "30 days"');
    expect(src("services/auth-billing-service/src/utils/emailTombstone.ts")).toContain('TOMBSTONE_RETENTION_SQL = "12 months"');
    expect(src("services/auth-billing-service/src/utils/profile.ts")).toMatch(/DELETION_GRACE_DAYS = 14/);
    const t = privacy();
    expect(t).toContain("90 days old");
    expect(t).toContain("cleared 30 days after the order was processed");
    expect(t).toContain("for 12 months, then delete it");
    expect(t).toContain("14-day grace period");
  });

  it("verification 24 h, reset 1 h, session 7 days, signup bonus 10 credits", () => {
    const auth = src("services/auth-billing-service/src/services/auth.service.ts");
    expect(auth).toContain("VERIFICATION_TTL_HOURS = 24");
    expect(auth).toContain("RESET_TTL_HOURS = 1");
    expect(auth).toContain("SIGNUP_CREDITS = 10");
    expect(src("services/auth-billing-service/src/config/env.ts")).toContain('JWT_EXPIRES_IN ?? "7d"');
    const t = privacy();
    expect(t).toContain("verification links expire after 24 hours, password-reset links after 1 hour");
    expect(t).toContain("(7 days by default)");
    expect(t).toContain("New accounts receive 10 credits once.");
  });
});
