/**
 * The privacy page may say "cleared automatically once the account is 90 days old" only when the owner has declared
 * (SITE_OWNER.signupIpPurgeJob) that the daily purge job is scheduled and monitored; otherwise it says what is true today.
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

async function privacyText(signupIpPurgeJob: string): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/legal/site-owner", async () => {
    const actual = await vi.importActual<typeof import("@/lib/legal/site-owner")>("@/lib/legal/site-owner");
    return { ...actual, SITE_OWNER: { ...actual.SITE_OWNER, signupIpPurgeJob } };
  });
  const { default: PrivacyPage } = await import("@/app/privacy/page");
  return renderToString(PrivacyPage()).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

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
