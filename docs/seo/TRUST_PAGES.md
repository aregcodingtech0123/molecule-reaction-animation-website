# Trust pages — sources and open points (D6, SEO-10)

**Status: drafts that need legal review.** `/about`, `/contact`, `/privacy`, `/terms` exist, are linked from the footer
of every page and from a links row on the home page, carry a visible "Draft — needs legal review" notice, and are
`noindex` (out of the sitemap) while any owner detail is a placeholder. `npm run check:launch-content` fails until every
placeholder in `src/lib/legal/site-owner.ts` is replaced (11 today). No Organization JSON-LD is emitted until then.

Nothing below is legal advice. The privacy text states only what the code does; every statement is listed here with the
code it comes from, so a reviewer can check it and so a code change that makes it untrue can be found.

## 1. Privacy policy — each statement and its source

| Statement on `/privacy` | Source in the code |
| --- | --- |
| No analytics, no advertising cookies | no analytics/tracking package or script in `src/` (searched for gtag, dataLayer, analytics, posthog, plausible, sentry: none) |
| Theme and language stored on the device (`moleculestudio-theme`, `moleculestudio-locale`) | `src/lib/theme/types.ts`, `src/lib/i18n/languages.ts`, `ThemeContext`, `LanguageContext` |
| Email/password signup stores email, bcrypt hash, first/last name, date of birth, signup IP, verified flag, creation time | `database/init/001…`, `002_user_profile_fields.sql` (names, DOB, `signup_ip`), `004_email_verification.sql` (`is_verified`); `services/…/utils/password.ts` (bcrypt); `services/…/services/auth.service.ts` (insert incl. `signup_ip`) |
| Google sign-in stores the Google account id and the confirmed email; name/DOB are **generated placeholders** | `services/…/utils/google.ts` (returns `email`, `googleSub` only); `oauth_accounts` table; `services/…/utils/profile.ts` `generateRandomProfile()` |
| One-time links stored as hashes; verification 24 h, reset 1 h | `verification_tokens` / `password_reset_tokens` (`token_hash`), `auth.service.ts` `VERIFICATION_TTL_HOURS = 24`, `RESET_TTL_HOURS = 1` |
| `session_token` cookie: HttpOnly, SameSite=Strict, Secure on https, session lifetime (7 days by default) | BFF cookie code (TC-29 assertions), `JWT_EXPIRES_IN` default `7d` in `services/…/config/env.ts` |
| Profile copy in local storage, removed on sign-out | `AUTH_USER_STORAGE_KEY` in `src/context/AuthContext.tsx` (`persistUser` / `clearPersistedUser` in `logout`) |
| Sign-out revokes the session until it would have expired | `services/…/controllers/auth.controller.ts` `logout` → `logoutCurrentToken` → `revoked_tokens` |
| Checkout sends email and account id to Lemon Squeezy; card data never reaches us | `services/…/lib/lemonsqueezy.ts` (`email`, `custom_data.user_id`), hosted checkout redirect |
| Order messages stored as received (with the buyer's email), credits ledger permanent, refunds stored, receipts emailed | `lemon_webhook_events.payload` (`015`), `credit_ledger_transactions` (`ON DELETE RESTRICT`, immutability triggers), `lemon_order_refunds` (`013`), `email.service.ts` `sendPurchaseReceiptEmail` |
| AI Lab: conversation sent to Gemini; messages not stored; one charge record per answer; logs carry account id + reference, never text | `src/app/api/chat/route.ts` (`boundConversation(messages)` → Gemini; `console.*` calls log `userId`, `referenceId` only), `ai_credit_holds` |
| Browser loads 3D structures from PubChem, sending the SMILES string and the IP | `src/lib/molecules/sdf-parser.ts` `fetchMoleculeFromSMILES` (browser `fetch` to `pubchem.ncbi.nlm.nih.gov`) |
| Emails through Resend | `services/…/lib/email.ts` |
| Ledger records cannot be deleted | `credit_ledger_transactions` FKs `ON DELETE RESTRICT`, `tests/db/immutability-and-constraints.test.ts` |

Not mentioned because the code no longer does it: Wikipedia/Wikimedia requests (removed in Part 2). Google Identity
Services: the Google sign-in button loads Google's script on the sign-in dialog; the policy says sign-in "with Google" but does
not yet describe the script's own data use — **add to legal review**.

## 2. Placeholders (owner and lawyer)

`legalName`, `country`, `postalAddress`, `contactEmail`, `governingLaw`, `refundPolicy`, `hostingProviders`
(`LAUNCH_CHECKLIST.md` recommends Vercel + Render + Neon, not decided), `logRetention` (decided by the hosting plans:
Vercel 1 h–30 days, Render 7–30 days per the checklist), `geminiDataUse` (Google's terms differ between paid and unpaid
Gemini API use — depends on the plan you choose), `accountDeletion` (the code has **no** self-service deletion, and the
database refuses to delete a user who has purchase records), `effectiveDate`.

## 3. Points for your decision (found while writing)

* **Generated name and date of birth for Google sign-ups.** Accounts created with Google get random first/last names and
  a random date of birth (age 18–69) from `generateRandomProfile()`. Storing invented personal data is unusual and the
  privacy policy has to say so (it does). Consider leaving these fields empty until the user fills them in.
* **Date of birth at signup** is required by validation; the policy needs a purpose for it (legal review), or it can be dropped.
* **`signup_ip`** is stored indefinitely with the account; the policy needs a purpose and a retention period.
* **Account deletion** does not exist as a feature; a privacy request process is needed before launch in most
  jurisdictions.
* **Content-policy blocks are charged** (`route.ts`: "Deliberately charged (captured)"); the terms and the pricing FAQ say so.
* **Credit expiry** is not decided anywhere in the code; the FAQ does not answer it.

## 4. Pages and links

Footer "Company" column: About → `/about` (was `/`), Contact, Privacy policy, Terms of use; the placeholder
"GitHub → https://github.com" link is removed from the footer and the Resources menu. The home page ends with "Common
questions" and a "Site information" links row (molecules, about, contact, privacy, terms). New labels are English (D1:
English-only indexing); the 12 locale dictionaries were not changed.
