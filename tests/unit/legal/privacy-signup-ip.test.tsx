/**
 * The privacy page may only describe a data practice as active when the owner has declared (SITE_OWNER_* variables) that the job that
 * makes it true is scheduled and monitored:
 *  - "cleared automatically once the account is 90 days old"  <- SITE_OWNER_SIGNUP_IP_PURGE_JOB (daily db:purge-signup-ips)
 *  - self-service deletion (14-day grace period)              <- SITE_OWNER_ACCOUNT_DELETION_JOB (daily db:process-deletions)
 *  - the 12-month e-mail hash of deleted accounts             <- SITE_OWNER_EMAIL_TOMBSTONE_GUARD starts with "enabled" (after legal review)
 * Otherwise it says what is true today. The variables are read on every render, so the tests only set the environment.
 */
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllEnvs());

function pageText(env: Record<string, string>): string {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return renderToString(PrivacyPage()).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}
const privacyText = (job: string) => pageText({ SITE_OWNER_SIGNUP_IP_PURGE_JOB: job });

describe("privacy policy: signup address retention", () => {
  it("while the purge job is not declared: no automatic-clearing claim, says it is planned", () => {
    const text = privacyText("");
    expect(text).not.toContain("cleared automatically");
    expect(text).not.toMatch(/once the account is 90 days old/);
    expect(text).toContain("kept with the account for now");
    expect(text).toContain("signed up from (kept with the account for now; an automatic clearing after 90 days is planned and will be stated here once it runs), whether");
  });

  it("a blank value counts as not declared", () => {
    expect(privacyText("   ")).not.toContain("cleared automatically");
  });

  it("once the owner declares the job: states the 90-day clearing", () => {
    const text = privacyText("Render Cron Job, daily 03:10 UTC; healthchecks.io alerts after 26 h");
    expect(text).toContain("signed up from (cleared automatically once the account is 90 days old), whether");
    expect(text).not.toContain("planned");
  });

  it("never prints the declaration itself", () => {
    expect(privacyText("Render Cron Job, daily 03:10 UTC; healthchecks.io alerts after 26 h")).not.toContain("healthchecks.io");
  });
});

describe("privacy policy: account deletion", () => {
  it("while the deletion job is not declared: says self-service deletion is not active yet and shows the manual route", () => {
    const text = pageText({ SITE_OWNER_ACCOUNT_DELETION_JOB: "", SITE_OWNER_ACCOUNT_DELETION: "email us at help@studio.example" });
    expect(text).toContain("self-service deletion is not active yet");
    expect(text).toContain("email us at help@studio.example");
    expect(text).not.toContain("14-day grace period");
    expect(text).not.toContain("Delete my account");
  });

  it("with neither the job nor the manual route given, the deletion paragraph is left out altogether", () => {
    const text = pageText({ SITE_OWNER_ACCOUNT_DELETION_JOB: "", SITE_OWNER_ACCOUNT_DELETION: "" });
    expect(text).not.toContain("Deleting your account");
    expect(text).not.toContain("not active yet");
  });

  it("once the owner declares the job: describes the 14-day grace period, the lost credits and the retained accounting records", () => {
    const text = pageText({ SITE_OWNER_ACCOUNT_DELETION_JOB: "Render Cron Job daily 03:30 UTC; heartbeat alert after 26 h" });
    expect(text).toContain("Delete my account");
    expect(text).toContain("14-day grace period, during which you can sign in and cancel");
    expect(text).toContain("your remaining credits are permanently lost and cannot be restored");
    expect(text).toContain("kept as the accounting record");
    expect(text).not.toContain("is not active yet");
  });
});

describe("privacy policy: the e-mail hash of deleted accounts (legal review)", () => {
  it.each([
    ["not set", ""],
    ["disabled", "disabled (legal review rejected it)"],
    ["blank", "  "],
    ["invalid", "maybe later"],
  ])("%s: the text does not mention it", (_label, value) => {
    expect(pageText({ SITE_OWNER_EMAIL_TOMBSTONE_GUARD: value })).not.toMatch(/keyed hash/);
  });

  it("enabled: states the 12-month keyed hash and its only purpose, without a legal conclusion", () => {
    const text = pageText({ SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "enabled (12 months), approved by counsel on 2026-12-01" });
    expect(text).toContain("one-way, keyed hash of the email address of a deleted account for 12 months, then delete it");
    expect(text).toContain("kept only for this purpose");
    expect(text).not.toMatch(/approved by counsel/); // the declaration is never printed
    expect(text).not.toMatch(/lawful|complian|permitted|GDPR|KVKK/i);
  });
});
