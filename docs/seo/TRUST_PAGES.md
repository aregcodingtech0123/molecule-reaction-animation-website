# Trust pages — sources and open points (D6, SEO-10)

**Status: drafts that need legal review.** `/about`, `/contact`, `/privacy`, `/terms` exist, are linked from the footer
of every page and from a links row on the home page, and carry a visible "Draft — needs legal review" notice until
`SITE_OWNER_LEGAL_REVIEWED=true` is set. The operator's details are **not in the code any more**: they are `SITE_OWNER_*` environment variables of
the web host (§2), read on every request. A field whose variable is empty is not shown, and neither is any sentence that depends on it; no
placeholder text is ever printed. The pages are `noindex` (out of the sitemap, no Organization JSON-LD) while any of the 14 **required**
variables is empty or malformed, and `npm run check:launch-content` fails naming them. They are English only. Questions for counsel: `LEGAL_REVIEW_QUESTIONS.md`.

Nothing below is legal advice. The privacy text states only what the code does; every statement is listed here with the
code it comes from, so a reviewer can check it and so a code change that makes it untrue can be found.

## 1. Privacy policy — each statement and its source

| Statement on `/privacy` | Source in the code |
| --- | --- |
| No analytics, no advertising cookies | no analytics/tracking package or script in `src/` (searched for gtag, dataLayer, analytics, posthog, plausible, sentry: none) |
| Theme and language stored on the device (`moleculestudio-theme`, `moleculestudio-locale`) | `src/lib/theme/types.ts`, `src/lib/i18n/languages.ts`, `ThemeContext`, `LanguageContext` |
| Email/password signup stores email, bcrypt hash, first/last name, date of birth, signup IP, verified flag, creation time | `database/init/001…`, `002_user_profile_fields.sql` (names, DOB, `signup_ip`), `004_email_verification.sql` (`is_verified`); `services/…/utils/password.ts` (bcrypt); `services/…/services/auth.service.ts` (insert incl. `signup_ip`) |
| Google sign-in stores the Google account id and the confirmed email; name/DOB are **not stored** (empty until the user enters them; GOOGLE_PROFILE_DESIGN, implemented) | `services/…/utils/google.ts` (returns `email`, `googleSub` only); `oauth_accounts` table; `services/…/services/auth.service.ts` (the Google branch passes no profile: `first_name`, `last_name`, `date_of_birth` stay NULL; `tests/api/users.google-profile.test.ts`) |
| One-time links stored as hashes; verification 24 h, reset 1 h | `verification_tokens` / `password_reset_tokens` (`token_hash`), `auth.service.ts` `VERIFICATION_TTL_HOURS = 24`, `RESET_TTL_HOURS = 1` |
| `session_token` cookie: HttpOnly, SameSite=Strict, Secure on https, session lifetime (7 days by default) | BFF cookie code (TC-29 assertions), `JWT_EXPIRES_IN` default `7d` in `services/…/config/env.ts` |
| `/privacy` "Download my data": one JSON of the user's own data after password or fresh-Google confirmation, no secrets | `services/…/services/export.service.ts`, `POST /api/users/export` (`tests/api/users.export.test.ts`) |
| Profile copy in local storage, removed on sign-out | `AUTH_USER_STORAGE_KEY` in `src/context/AuthContext.tsx` (`persistUser` / `clearPersistedUser` in `logout`) |
| Sign-out revokes the session until it would have expired | `services/…/controllers/auth.controller.ts` `logout` → `logoutCurrentToken` → `revoked_tokens` |
| Checkout sends email and account id to Lemon Squeezy; card data never reaches us | `services/…/lib/lemonsqueezy.ts` (`email`, `custom_data.user_id`), hosted checkout redirect |
| Order messages stored as received (with the buyer's email), credits ledger permanent, refunds stored, receipts emailed | `lemon_webhook_events.payload` (`015`), `credit_ledger_transactions` (`ON DELETE RESTRICT`, immutability triggers), `lemon_order_refunds` (`013`), `email.service.ts` `sendPurchaseReceiptEmail` |
| AI Lab: conversation sent to Gemini; messages not stored; one charge record per answer; logs carry account id + reference, never text | `src/app/api/chat/route.ts` (`boundConversation(messages)` → Gemini; `console.*` calls log `userId`, `referenceId` only), `ai_credit_holds` |
| Browser loads 3D structures from PubChem, sending the SMILES string and the IP | `src/lib/molecules/sdf-parser.ts` `fetchMoleculeFromSMILES` (browser `fetch` to `pubchem.ncbi.nlm.nih.gov`) |
| Emails through Resend | `services/…/lib/email.ts` |
| `signup_ip` cleared when the account is 90 days old — **conditional**: the page says it only when `SITE_OWNER_SIGNUP_IP_PURGE_JOB` is set; otherwise "kept with the account for now; an automatic clearing after 90 days is planned" | migration `016_signup_ip_retention.sql` `purge_signup_ips()` + daily `npm run db:purge-signup-ips` with a heartbeat alert (true only while the job runs: launch checklist §5.1, mandatory; `tests/unit/legal/privacy-signup-ip.test.tsx`) |
| The stored Lemon order message is cleared 30 days after processing | `services/…/services/webhookInbox.service.ts` `PAYLOAD_RETENTION = "30 days"` (`UPDATE lemon_webhook_events SET payload = NULL …`) |
| Ledger records cannot be deleted | `credit_ledger_transactions` FKs `ON DELETE RESTRICT`, `tests/db/immutability-and-constraints.test.ts` |

Not mentioned because the code no longer does it: Wikipedia/Wikimedia requests (removed in Part 2). Google Identity
Services: the Google sign-in button loads Google's script on the sign-in dialog; the policy says sign-in "with Google" but does
not yet describe the script's own data use — **add to legal review**.

## 2. Owner variables (what only you can supply)

All are `SITE_OWNER_<NAME>` on the **web** host (Next.js), server-side, per request, never `NEXT_PUBLIC_*`; format and long-text rules: runbook §5. Plain text only
(rendered escaped, never as HTML). An empty or malformed value is treated as not set.

| Variable | Required | Used for | Where it shows |
| --- | --- | --- | --- |
| `SITE_OWNER_LEGAL_NAME` | yes | who operates the site | About, Contact, Privacy, Terms, Organization JSON-LD |
| `SITE_OWNER_COUNTRY` | yes | country of the operator | the same |
| `SITE_OWNER_POSTAL_ADDRESS` | yes | postal address for legal notices | Contact, Privacy, Terms, JSON-LD |
| `SITE_OWNER_CONTACT_EMAIL` | yes | general contact; privacy requests unless a privacy address is set | all four, JSON-LD |
| `SITE_OWNER_GOVERNING_LAW` | yes | governing law and courts | Terms ("Governing law" section) |
| `SITE_OWNER_REFUND_POLICY` | yes | refund policy (Lemon Squeezy is merchant of record; this is the operator's wording); text or one https URL | Terms ("Refunds" section) |
| `SITE_OWNER_HOSTING_PROVIDERS` | yes | where the site and database are hosted (the checklist recommends Vercel + Render + Neon; not decided) | Privacy |
| `SITE_OWNER_LOG_RETENTION` | yes | decided by the hosting plans (Vercel 1 h–30 days, Render 7–30 days per the checklist) | Privacy |
| `SITE_OWNER_GEMINI_DATA_USE` | yes | Google's terms differ between paid and unpaid Gemini API use | Privacy |
| `SITE_OWNER_ACCOUNT_DELETION` | yes | the e-mail route for deletion and what is kept | Privacy, Terms |
| `SITE_OWNER_SIGNUP_IP_PURGE_JOB` | yes | your statement that the daily purge runs and is monitored; **never displayed**; lets the policy state the 90 days | Privacy (one sentence) |
| `SITE_OWNER_ACCOUNT_DELETION_JOB` | yes | the same for the daily deletion job; **never displayed**; lets the policy describe self-service deletion as active | Privacy (one paragraph) |
| `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` | yes | `enabled …`/`disabled …` after legal review of the 12-month e-mail hash; **never displayed**; must match `EMAIL_TOMBSTONE_GUARD` on the service | Privacy (one paragraph, only when enabled) |
| `SITE_OWNER_EFFECTIVE_DATE` | yes | effective date, `YYYY-MM-DD` | all four (footer line) |
| `SITE_OWNER_REGISTRATION_NUMBER` | no | company registration or tax number | About, Contact, Privacy |
| `SITE_OWNER_SUPPORT_EMAIL` | no | separate support address | Contact |
| `SITE_OWNER_PRIVACY_EMAIL` | no | privacy requests / data-protection contact | Contact, Privacy |
| `SITE_OWNER_PHONE` | no | telephone | Contact, JSON-LD |
| `SITE_OWNER_LAST_UPDATED` | no | `YYYY-MM-DD` | footer line |
| `SITE_OWNER_LEGAL_REVIEWED` | no | `true` removes the draft notice (nothing else) | all four |

Data retention periods stated on the pages (90 days signup address, 30 days stored order message, 12 months e-mail hash, 14-day deletion grace, 24 h / 1 h links,
7-day session) are **not** variables: they are what the code does, and `tests/unit/legal/trust-pages.test.tsx` fails if the code and the text drift apart.
Changing one means changing the code and the text together.

## 3. Points for your decision (found while writing)

* **Name and date of birth for Google sign-ups — done.** Google accounts no longer get invented values (they stay empty until the user enters them, and the profile page can clear any stored value). `GOOGLE_PROFILE_DESIGN.md`.
* **Date of birth at signup** is required by validation; the policy needs a purpose for it (legal review), or it can be dropped.
* **`signup_ip`**: now cleared after 90 days (migration 016 + a daily job, `PRIVACY_FOLLOWUPS.md` §1). The policy still needs a *purpose* for collecting it (the column comment says "abuse heuristics"; the code never reads it) — legal review.
* **Account deletion** does not exist as a feature; a privacy request process is needed before launch in most
  jurisdictions.
* **Content-policy blocks are charged** (`route.ts`: "Deliberately charged (captured)"); the terms and the pricing FAQ say so.
* **Credit expiry** is not decided anywhere in the code; the FAQ does not answer it.

## 4. Pages and links

Footer "Company" column: About → `/about` (was `/`), Contact, Privacy policy, Terms of use; the placeholder
"GitHub → https://github.com" link is removed from the footer and the Resources menu. The home page ends with "Common
questions" and a "Site information" links row (molecules, about, contact, privacy, terms). New labels are English (D1:
English-only indexing); the 12 locale dictionaries were not changed.
