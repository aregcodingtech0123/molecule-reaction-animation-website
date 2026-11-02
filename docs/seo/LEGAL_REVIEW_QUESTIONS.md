# Questions for counsel — trust pages (`/privacy`, `/terms`, `/about`, `/contact`)

For the lawyer who reviews the drafts. Nothing in this repository claims legal compliance: the pages state what the code does, in plain English, and the
owner-supplied facts (`SITE_OWNER_*`, [`TRUST_PAGES.md`](TRUST_PAGES.md) §2) are shown as written. Each statement on the privacy page and the code it comes
from is listed in [`TRUST_PAGES.md`](TRUST_PAGES.md) §1; the facts about the processors' own documents are in
[`../ops/PRODUCTION_RUNBOOK.md`](../ops/PRODUCTION_RUNBOOK.md) §11.4–§11.5 (read 2026-11-01). Where a question depends on the operator's country, say so
in the answer: the operator is a single owner, the users are worldwide, and the first markets are not decided.

When the review is done, set `SITE_OWNER_LEGAL_REVIEWED=true` on the web host: that removes the "Draft — needs legal review" notice from all four pages and
changes nothing else.

## 1. Roles and applicable law

1. **Controller / processor.** Which of the operator's roles under KVKK (Turkish Law No. 6698) and the GDPR is the operator in: controller of account, ledger
   and AI-Lab data? Is the operator a joint controller with Lemon Squeezy for buyers' data? Lemon Squeezy's DPA calls it a processor for the data the merchant
   supplies, its privacy policy says "Data Controller and/or Processor" (runbook §11.4).
2. **Lemon Squeezy as merchant of record.** The pages say payments, tax, refunds and chargebacks are Lemon Squeezy's under its terms. Is that sentence
   accurate and sufficient, and who answers a buyer's request for erasure of order data (the documents do not say whether it can be erased)?
3. **Which law, which courts.** What goes into `SITE_OWNER_GOVERNING_LAW` for consumers outside the operator's country? Do mandatory consumer-protection rules
   of the buyer's country override it, and should the terms say so?
4. **Do the pages need a registration, a representative or a named data-protection contact** (VERBİS, an EU/UK representative, a DPO) at this scale, and what
   belongs in `SITE_OWNER_PRIVACY_EMAIL` and `SITE_OWNER_REGISTRATION_NUMBER`?

## 2. What the privacy page says — please confirm or correct

5. **Legal basis and purpose per use** (the page gives none, on purpose): account and sign-in, ledger and receipts, AI Lab processing, signup address,
   verification and reset mail. Which basis, and what must the page say about each?
6. **Date of birth** is required at signup and stored; the code uses it for nothing else. Is a purpose needed, or should the field be dropped?
7. **Signup IP address** is stored at registration and cleared after 90 days by a daily job (the page says so only when `SITE_OWNER_SIGNUP_IP_PURGE_JOB` is
   set). Is the purpose ("abuse heuristics") adequate and is 90 days proportionate?
8. **Children / age.** The code enforces **no minimum age** (it only validates that a date of birth was entered), so the pages make no age statement. What
   must the terms and the privacy page say, and should registration enforce an age limit?
9. **Cookies and local storage.** One strictly necessary session cookie (`session_token`: HttpOnly, SameSite=Strict, Secure on https), local-storage keys for
   theme, language and a copy of the profile; no analytics, no advertising. Is any consent notice required for that set? Google's sign-in script and the
   browser's direct requests to PubChem (it sees the visitor's IP) are mentioned only briefly: is that enough?
10. **Retention periods** as built: signup address 90 days; stored Lemon order message 30 days after processing; e-mail hash of deleted accounts 12 months;
    deletion grace 14 days; one-time links 24 h / 1 h; ledger and order records kept indefinitely because the database refuses to delete them. Are these
    defensible, in particular **keeping the ledger and purchase records without a limit** (accounting/tax retention periods in the operator's country)?
11. **The e-mail hash guard.** A keyed hash (HMAC-SHA256) of a deleted account's e-mail is kept 12 months so the 10-credit signup bonus cannot be collected
    again. It is still personal data. Is it permitted next to the right to erasure (GDPR Art. 17; KVKK Art. 7), what is the legal basis (legitimate interest in
    preventing abuse?), is 12 months proportionate, and what exact wording does `/privacy` need? Decision: set `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` to
    `enabled …` or `disabled …` **and** `EMAIL_TOMBSTONE_GUARD` on the API service to match (`npm run check:config` checks that they agree).
12. **Rights and requests.** Export ("Download my data") and deletion (14-day grace period, remaining credits lost, accounting records kept without name or
    e-mail) are self-service. Is that a sufficient way to honour access, portability and erasure requests, what response time must the page promise, and is
    the "remaining credits are permanently lost" consequence acceptable?
13. **International transfers.** Data goes to Google (sign-in; Gemini prompts), Lemon Squeezy, Resend and the hosting providers, mostly outside the EEA/Türkiye.
    **Resend** states it stores customer data in the United States and does not sign country-specific agreements, naming the Türkiye KVKK Standard Contract
    (runbook §11.5). What does the page need to say, and is using Resend acceptable for Turkish users, or should the mail provider change?
14. **AI Lab prompts.** Conversations are sent to Google's Gemini API and not stored by the service. The wording depends on the Gemini plan used
    (`SITE_OWNER_GEMINI_DATA_USE`): which statement is correct for the paid vs the unpaid tier, and must users be warned not to enter personal data?
15. **Breach and security statements.** The page says nothing about breach notification or security measures. Is that acceptable?

## 3. Terms of use

16. **Blocked-but-charged answers.** If the model's answer is withheld because it broke the content policy, the credit is still charged (the model ran and was
    paid for; releasing would make probing the filter free). The terms say so. Is that term enforceable against consumers, and should it be more prominent
    at the point of purchase and in the AI Lab?
17. **Refunds and withdrawal.** What goes into `SITE_OWNER_REFUND_POLICY`? Digital content and credits consumed on delivery: is the statutory withdrawal right
    (EU/UK 14 days, Turkish distance-selling rules) waived or limited, and how must that be presented? Credits are never clawed back automatically after a
    Lemon refund (reviewed by hand): is that stated correctly?
18. **Credit expiry and loss.** Credits do not expire in the code and are lost on account deletion. Should the terms say so explicitly, and what happens to
    credits when the service ends or the account is closed by the operator?
19. **Liability limits, disclaimers, acceptable use, termination, changes to the terms.** The draft contains none (only "answers can be wrong; not for
    laboratory, medical or safety decisions"). Please supply or approve the wording; note that account suspension has no tool beyond SQL today.
20. **Content and ownership.** Who owns the AI answers shown to the user, and may the user republish them? Third-party data is credited on the pages (NIST,
    PubChem): is that attribution sufficient for the licences involved?
21. **Governing law section** appears only when `SITE_OWNER_GOVERNING_LAW` is set; **refund** and **deletion-by-e-mail** text likewise. Is it acceptable that a
    missing value simply omits its section, given the launch gate stops publication while required values are empty?

## 4. Operational

22. Is the "Draft — needs legal review" notice sufficient for a soft launch of the pages with the required variables set but not yet reviewed, or must the pages
    stay hidden (`noindex`, which is the default until every required variable is set) until review is complete?
23. Which dated version of the policy must be kept when it changes (`SITE_OWNER_EFFECTIVE_DATE`, `SITE_OWNER_LAST_UPDATED` show only the two dates)?
