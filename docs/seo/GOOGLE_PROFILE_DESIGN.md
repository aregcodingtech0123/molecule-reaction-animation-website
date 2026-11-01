# Design note — stop inventing a name and date of birth for Google sign-ups

**Status: proposal only. Touches the auth service. Nothing here is implemented; waiting for the owner's approval.**
Branch `seo/aeo-geo`, written 2026-11-01 from the code as it is today.

## 1. What happens today

* `registerOrLoginWithGoogle` (`services/auth-billing-service/src/services/auth.service.ts`, brand-new user branch) calls
  `generateRandomProfile()` (`utils/profile.ts`: random first name, random last name, random date of birth for age 18–69) and
  passes it to `insertUser`. Nothing marks the values as generated.
* The database does not need them: `first_name`, `last_name`, `date_of_birth` are nullable (no `NOT NULL` in migrations 001/002).
* The signup bonus (`grantSignupBonus`), `is_verified = true`, the `oauth_accounts` link and the session are unrelated to the profile.

## 2. The finding that makes this smaller than I proposed before

My earlier note said the response shape would change from a string to `null` and "every consumer must tolerate it". **That is not
needed.** `toPublicUserProfile` already maps `NULL` to `""` (`firstName: row.first_name ?? ""`, `formatDateOfBirth(null)` → `""`), and
every consumer already copes with `""`:

| Consumer | Behaviour with `""` today |
| --- | --- |
| `AuthContext.readPersistedUser` | `parsed.firstName ?? ""` – already empty-safe |
| Navbar `displayUserName` | returns `null` for an empty name → shows the "Profile" label |
| Profile page (view) | first name `profile.firstName || "—"`, date of birth `formatDateOfBirthForDisplay("")` → `"—"` |
| Profile page (edit form) | inputs start empty |
| Verification e-mail (`buildVerificationEmail`) | `firstName \|\| "there"` (not sent to Google users, who are verified) |
| Purchase receipt (`loadReceiptRecipient`) | name falls back to the e-mail local part, then `"there"` |

So the **API contract stays strings; `""` means "not provided"**. Existing clients, the BFF and the localStorage copy keep working
unchanged, which is the whole backward-compatibility story.

## 3. Proposed change (service ~25 lines, UI ~10, tests)

1. `insertUser` takes `profile?: UserProfileInput`; when absent it stores `NULL` in the three columns. The Google branch passes none.
   `generateRandomProfile` and its constants are deleted (nothing else uses it).
2. **Saving the profile page.** Today `profile/page.tsx` validates and sends all three fields, and the service's
   `validateProfileUpdate` rejects an empty date of birth, so a Google user who only wants to enter a first name would be told the
   date of birth is invalid. Change: the page sends only the fields that are non-empty. No change to what the service accepts.
   *Option B (needs your call):* also let the page **clear** a stored value (PATCH with `null`), which is what a user needs to remove
   the invented values of an existing account (§4). Not required for new accounts.
3. Privacy page: replace the sentence "those profile fields are filled with generated placeholder values" with "we do not receive
   your name or date of birth from Google and do not store any until you enter them" (`/privacy`, `TRUST_PAGES.md` row).
4. **Email/password sign-up is unchanged** (name and date of birth are still required there; whether the date of birth is needed at
   all is a separate legal-purpose question already in `TRUST_PAGES.md`).

Not touched: login, sessions, tokens, the ledger, balances, billing, the signup bonus, `oauth_accounts`, rate limits, CSP.

## 4. Existing accounts with generated values

* **Production launches on a fresh, empty database** (`LAUNCH_CHECKLIST.md` §2.2–2.3), so there are no such accounts there. Only
  development databases hold them.
* Should some exist anyway: a one-off migration **cannot tell generated from real** values safely. There is an exact marker for
  "created through Google" – `users.created_at = oauth_accounts.created_at` for the Google row, because both rows are inserted in
  one transaction and `NOW()` is the transaction time – but the user may have edited the profile since, and `users.updated_at`
  cannot show that (any update, now also the signup-address purge, moves it). So: **no silent nulling.**
* Option, only if you want it: the profile page shows a notice for accounts matching that marker ("These details were filled in
  automatically when you signed up with Google – please correct or remove them"), and Option B above provides the removal.

## 5. Tests that change or are added (all on PostgreSQL 18, none weakened)

* `tests/unit/pure-modules.test.ts` "generateRandomProfile always produces input that passes validation" is **removed with the
  function** (its subject no longer exists; record in `TEST_CHANGES.md`). Replaced by: a new Google user has `NULL` in all three
  columns and the auth response carries `""`; the signup bonus, `is_verified`, the oauth link and the session are exactly as before;
  the race test (`auth.google-race.test.ts`) and takeover tests keep their assertions.
* Added: a Google user can save only a first name; a purchase receipt for such a user greets by e-mail local part; linking Google to
  an existing real account still keeps the real name and date of birth.
* UI: profile page with empty fields (view shows "—", save sends only filled fields), Navbar label.

## 6. Rollout and rollback

No migration, no new column. Rollback = revert the commit; accounts created meanwhile keep `NULL` columns, which the old code also
reads as `""`. New Google users created by the old code after a rollback would again get generated values (the only difference).

## 7. Decisions needed

1. Go / no-go for the change in §3 (items 1–3).
2. Option B – allow clearing a stored value from the profile page? (Recommended: yes, small, and it is the user's own data.)
3. The "created through Google" notice for existing accounts (§4): yes / no.
