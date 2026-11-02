/** The SITE_OWNER_* reader: per-request, normalised, validated, and consistent with the other places that list the variables. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockingFields,
  OWNER_FIELDS,
  paragraphsOf,
  privacyContact,
  readSiteOwner,
  REQUIRED_FIELDS,
  singleHttpsUrl,
  tombstoneGuardEnabled,
  trustPagesReady,
} from "@/lib/legal/site-owner";
import { OWNER_ENV_NAMES } from "../../../scripts/test/e2e-env.mjs";
import { FULL_OWNER_ENV, ownerEnvWithout } from "../../support/site-owner-env";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("field list", () => {
  it("has the 14 required variables the gate always had, plus the optional ones, all prefixed SITE_OWNER_ and none NEXT_PUBLIC_", () => {
    expect(REQUIRED_FIELDS.map((f) => f.key).sort()).toEqual(
      ["legalName", "country", "postalAddress", "contactEmail", "governingLaw", "refundPolicy", "hostingProviders", "logRetention", "geminiDataUse", "accountDeletion", "signupIpPurgeJob", "accountDeletionJob", "emailTombstoneGuard", "effectiveDate"].sort(),
    );
    for (const f of OWNER_FIELDS) {
      expect(f.env).toMatch(/^SITE_OWNER_[A-Z_]+$/);
      expect(f.env).not.toContain("NEXT_PUBLIC");
    }
    expect(new Set(OWNER_FIELDS.map((f) => f.env)).size).toBe(OWNER_FIELDS.length);
  });

  it("every variable (and the review switch) is in .env.example, the e2e env list, the runbook and the launch checklist", () => {
    const names = [...OWNER_FIELDS.map((f) => f.env), "SITE_OWNER_LEGAL_REVIEWED"];
    const example = read(".env.example");
    const runbook = read("docs/ops/PRODUCTION_RUNBOOK.md");
    const launch = read("docs/ops/LAUNCH_CHECKLIST.md");
    for (const n of names) {
      expect(example, `.env.example ${n}`).toContain(`${n}=`);
      expect(runbook, `runbook ${n}`).toContain(`\`${n}\``);
      expect(launch, `checklist ${n}`).toContain(`\`${n}\``);
    }
    expect([...OWNER_ENV_NAMES].sort()).toEqual([...names].sort());
  });

  it("the page code reads the variables only through the reader (no process.env.SITE_OWNER_ anywhere in src)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const file of walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(fs.readFileSync(file, "utf8"), file).not.toMatch(/process\.env\.SITE_OWNER_|NEXT_PUBLIC_SITE_OWNER/);
    }
  });
});

describe("readSiteOwner", () => {
  it("an empty environment: nothing set, every required variable listed as empty, draft notice on", () => {
    const status = readSiteOwner({});
    expect(status.empty).toHaveLength(14);
    expect(status.invalid).toEqual([]);
    expect(Object.values(status.owner).every((v) => v === "")).toBe(true);
    expect(status.legalReviewed).toBe(false);
    expect(trustPagesReady({})).toBe(false);
  });

  it("a full environment: ready, values as given, review switch on", () => {
    const status = readSiteOwner(FULL_OWNER_ENV);
    expect(status.empty).toEqual([]);
    expect(status.invalid).toEqual([]);
    expect(status.owner.legalName).toBe("Example Studio Ltd");
    expect(status.legalReviewed).toBe(true);
    expect(trustPagesReady(FULL_OWNER_ENV)).toBe(true);
  });

  it("is evaluated at call time, not at import time (per-request)", () => {
    expect(trustPagesReady({})).toBe(false);
    expect(trustPagesReady(FULL_OWNER_ENV)).toBe(true);
    expect(trustPagesReady({ ...FULL_OWNER_ENV, SITE_OWNER_COUNTRY: "" })).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(trustPagesReady()).toBe(false);
    process.env.SITE_OWNER_LEGAL_NAME = "Example Studio Ltd";
    try {
      expect(readSiteOwner().owner.legalName).toBe("Example Studio Ltd");
    } finally {
      delete process.env.SITE_OWNER_LEGAL_NAME;
    }
  });

  it("trims, accepts real and literal \\n line breaks, strips control characters, and keeps at most one blank line", () => {
    const s = readSiteOwner({
      ...FULL_OWNER_ENV,
      SITE_OWNER_LEGAL_NAME: "  Example\u0000 Studio \n Ltd  ",
      SITE_OWNER_POSTAL_ADDRESS: "1 Example Street\\nExample City\r\n\r\n\r\n\r\nExampleland",
    }).owner;
    expect(s.legalName).toBe("Example Studio Ltd"); // a one-line field loses its line breaks
    expect(s.postalAddress).toBe("1 Example Street\nExample City\n\nExampleland");
  });

  it("invalid values count as not set (never shown) and, if required, block the launch", () => {
    const bad = readSiteOwner({
      ...FULL_OWNER_ENV,
      SITE_OWNER_CONTACT_EMAIL: "no at sign",
      SITE_OWNER_SUPPORT_EMAIL: "a@b@c.example",
      SITE_OWNER_EFFECTIVE_DATE: "2026-1-1",
      SITE_OWNER_PHONE: "12",
      SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "enable",
      SITE_OWNER_COUNTRY: "x".repeat(101),
    });
    expect(bad.invalid.map((f) => f.env).sort()).toEqual(
      ["SITE_OWNER_CONTACT_EMAIL", "SITE_OWNER_COUNTRY", "SITE_OWNER_EFFECTIVE_DATE", "SITE_OWNER_EMAIL_TOMBSTONE_GUARD", "SITE_OWNER_PHONE", "SITE_OWNER_SUPPORT_EMAIL"].sort(),
    );
    expect(bad.owner.contactEmail).toBe("");
    expect(bad.owner.phone).toBe("");
    expect(blockingFields(bad).map((f) => f.env).sort()).toEqual(
      ["SITE_OWNER_CONTACT_EMAIL", "SITE_OWNER_COUNTRY", "SITE_OWNER_EFFECTIVE_DATE", "SITE_OWNER_EMAIL_TOMBSTONE_GUARD"].sort(),
    );
  });

  it.each([
    ["a@b.example", true],
    ["first.last+tag@sub.studio.example", true],
    ["a@b", false],
    ["<a@b.example>", false],
    ["a@b.example, c@d.example", false],
    ['"a"@b.example', false],
  ])("e-mail %s -> %s", (value, ok) => {
    expect(readSiteOwner({ ...FULL_OWNER_ENV, SITE_OWNER_CONTACT_EMAIL: value }).owner.contactEmail !== "").toBe(ok);
  });

  it.each([
    ["2026-02-28", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["26-01-01", false],
  ])("date %s -> %s", (value, ok) => {
    expect(readSiteOwner({ ...FULL_OWNER_ENV, SITE_OWNER_EFFECTIVE_DATE: value }).owner.effectiveDate !== "").toBe(ok);
  });

  it("the review switch is exactly 'true' (any case); it never makes pages indexable by itself", () => {
    for (const v of ["true", "TRUE", " True "]) expect(readSiteOwner({ SITE_OWNER_LEGAL_REVIEWED: v }).legalReviewed).toBe(true);
    for (const v of ["", "false", "1", "yes", "tru"]) expect(readSiteOwner({ SITE_OWNER_LEGAL_REVIEWED: v }).legalReviewed).toBe(false);
    expect(trustPagesReady({ SITE_OWNER_LEGAL_REVIEWED: "true" })).toBe(false);
    expect(trustPagesReady(ownerEnvWithout("SITE_OWNER_LEGAL_REVIEWED"))).toBe(true);
  });

  it("the e-mail hash decision: 'enabled' (any case, any continuation) is on, 'disabled' is off, the word must stand alone", () => {
    const g = (v: string) => tombstoneGuardEnabled(readSiteOwner({ ...FULL_OWNER_ENV, SITE_OWNER_EMAIL_TOMBSTONE_GUARD: v }).owner);
    expect(g("enabled")).toBe(true);
    expect(g("Enabled - counsel agreed")).toBe(true);
    expect(g("disabled (counsel said no)")).toBe(false);
    expect(readSiteOwner({ SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "enabledish" }).invalid).toHaveLength(1);
  });

  it("the privacy contact is the dedicated address, else the general one, else nothing", () => {
    const o = (env: Record<string, string>) => privacyContact(readSiteOwner(env).owner);
    expect(o(FULL_OWNER_ENV)).toBe("privacy@studio.example");
    expect(o(ownerEnvWithout("SITE_OWNER_PRIVACY_EMAIL"))).toBe("hello@studio.example");
    expect(o({})).toBe("");
  });
});

describe("text helpers", () => {
  it("paragraphs are blank-line separated, lines are single breaks", () => {
    expect(paragraphsOf("a\nb\n\nc")).toEqual([["a", "b"], ["c"]]);
    expect(paragraphsOf("")).toEqual([]);
  });

  it("a refund policy that is exactly one https URL is a link; http, text around it, or script URLs are not", () => {
    expect(singleHttpsUrl("https://studio.example/refunds")).toBe("https://studio.example/refunds");
    expect(singleHttpsUrl("http://studio.example/refunds")).toBeNull();
    expect(singleHttpsUrl("See https://studio.example/refunds")).toBeNull();
    expect(singleHttpsUrl("https://studio.example/a b")).toBeNull();
    expect(singleHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(singleHttpsUrl('https://studio.example/"onmouseover="x')).toBeNull();
  });
});
