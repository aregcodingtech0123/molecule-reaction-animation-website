/**
 * The privacy page may only describe a data practice as active when the owner has declared (SITE_OWNER) that the job that makes it
 * true is scheduled and monitored:
 *  - "cleared automatically once the account is 90 days old"  <- signupIpPurgeJob (daily db:purge-signup-ips)
 *  - self-service deletion (14-day grace period)              <- accountDeletionJob (daily db:process-deletions)
 *  - the 12-month e-mail hash of deleted accounts             <- emailTombstoneGuard starts with "enabled" (after legal review)
 * Otherwise it says what is true today.
 */
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.doUnmock("@/lib/legal/site-owner");
  vi.resetModules();
});

async function pageText(overrides: Record<string, string>): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/legal/site-owner", async () => {
    const actual = await vi.importActual<typeof import("@/lib/legal/site-owner")>("@/lib/legal/site-owner");
    return { ...actual, SITE_OWNER: { ...actual.SITE_OWNER, ...overrides } };
  });
  const { default: PrivacyPage } = await import("@/app/privacy/page");
  return renderToString(PrivacyPage()).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}
const privacyText = (signupIpPurgeJob: string) => pageText({ signupIpPurgeJob });

describe("privacy policy: signup address retention", () => {
  it("while the purge job is a placeholder: no automatic-clearing claim, says it is planned", async () => {
    const text = await privacyText("TODO(owner): where the job runs");
    expect(text).not.toContain("cleared automatically");
    expect(text).not.toMatch(/once the account is 90 days old/);
    expect(text).toContain("kept with the account for now");
    expect(text).toContain("signed up from (kept with the account for now; an automatic clearing after 90 days is planned and will be stated here once it runs), whether");
  });

  it("an empty value counts as not declared", async () => {
    expect(await privacyText("   ")).not.toContain("cleared automatically");
  });

  it("once the owner declares the job: states the 90-day clearing", async () => {
    const text = await privacyText("Render Cron Job, daily 03:10 UTC; healthchecks.io alerts after 26 h");
    expect(text).toContain("signed up from (cleared automatically once the account is 90 days old), whether");
    expect(text).not.toContain("planned");
  });
});

describe("privacy policy: account deletion", () => {
  it("while the deletion job is a placeholder: says self-service deletion is not active yet and points to the manual route", async () => {
    const text = await pageText({ accountDeletionJob: "TODO(owner): where the job runs", accountDeletion: "email us at help@studio.example" });
    expect(text).toContain("self-service deletion is being introduced and is not active yet");
    expect(text).toContain("email us at help@studio.example");
    expect(text).not.toContain("14-day grace period");
    expect(text).not.toContain("Delete my account");
  });

  it("once the owner declares the job: describes the 14-day grace period, the lost credits and the retained accounting records", async () => {
    const text = await pageText({ accountDeletionJob: "Render Cron Job daily 03:30 UTC; heartbeat alert after 26 h" });
    expect(text).toContain("Delete my account");
    expect(text).toContain("14-day grace period, during which you can sign in and cancel");
    expect(text).toContain("your remaining credits are permanently lost and cannot be restored");
    expect(text).toContain("kept as the accounting record");
    expect(text).not.toContain("is not active yet");
  });
});

describe("privacy policy: the e-mail hash of deleted accounts (legal review)", () => {
  it.each([
    ["a placeholder", "TODO(owner): decide after legal review"],
    ["disabled", "disabled (legal review rejected it)"],
    ["blank", "  "],
  ])("%s: the text does not mention it", async (_label, value) => {
    expect(await pageText({ emailTombstoneGuard: value })).not.toMatch(/keyed hash/);
  });

  it("enabled: a marked draft paragraph states the 12-month keyed hash, that it is still personal data, and that legal review decides", async () => {
    const text = await pageText({ emailTombstoneGuard: "enabled (12 months), approved by counsel on 2026-12-01" });
    expect(text).toContain("[Draft — needs legal review before launch]");
    expect(text).toContain("one-way, keyed hash of the email address of a deleted account for 12 months, then delete it");
    expect(text).toContain("it is still personal data");
    expect(text).toContain("right to erasure");
  });
});
