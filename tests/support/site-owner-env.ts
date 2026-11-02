/** Fictional owner details for tests: every SITE_OWNER_* variable, set. Nothing here is a real person, address or number. */
export const FULL_OWNER_ENV: Record<string, string> = {
  SITE_OWNER_LEGAL_NAME: "Example Studio Ltd",
  SITE_OWNER_COUNTRY: "Exampleland",
  SITE_OWNER_REGISTRATION_NUMBER: "REG-000000",
  SITE_OWNER_POSTAL_ADDRESS: "1 Example Street\nExample City 00000",
  SITE_OWNER_CONTACT_EMAIL: "hello@studio.example",
  SITE_OWNER_SUPPORT_EMAIL: "support@studio.example",
  SITE_OWNER_PRIVACY_EMAIL: "privacy@studio.example",
  SITE_OWNER_PHONE: "+00 000 000 0000",
  SITE_OWNER_GOVERNING_LAW: "The laws of Exampleland; the courts of Example City.",
  SITE_OWNER_REFUND_POLICY: "Refunds within 14 days if no credits were used.\n\nContact us with your order number.",
  SITE_OWNER_HOSTING_PROVIDERS: "Example Cloud (web), Example API Host (API), Example DB (database)",
  SITE_OWNER_LOG_RETENTION: "Hosting logs are kept for 7 days.",
  SITE_OWNER_GEMINI_DATA_USE: "Under the paid plan Google does not use prompts to train its models.",
  SITE_OWNER_ACCOUNT_DELETION: "Write to us from your account address and we delete the account within 30 days.",
  SITE_OWNER_SIGNUP_IP_PURGE_JOB: "Example Cron, daily 03:10 UTC; heartbeat alert after 26 h",
  SITE_OWNER_ACCOUNT_DELETION_JOB: "Example Cron, daily 03:30 UTC; heartbeat alert after 26 h",
  SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "enabled (12 months), decision recorded 2026-01-01",
  SITE_OWNER_EFFECTIVE_DATE: "2026-01-01",
  SITE_OWNER_LAST_UPDATED: "2026-02-01",
  SITE_OWNER_LEGAL_REVIEWED: "true",
};

/** The same details with some variables removed. */
export function ownerEnvWithout(...names: string[]): Record<string, string> {
  const env = { ...FULL_OWNER_ENV };
  for (const n of names) delete env[n];
  return env;
}

/** The optional variables (everything the launch gate does not require). */
export const OPTIONAL_OWNER_VARS = [
  "SITE_OWNER_REGISTRATION_NUMBER",
  "SITE_OWNER_SUPPORT_EMAIL",
  "SITE_OWNER_PRIVACY_EMAIL",
  "SITE_OWNER_PHONE",
  "SITE_OWNER_LAST_UPDATED",
  "SITE_OWNER_LEGAL_REVIEWED",
];
