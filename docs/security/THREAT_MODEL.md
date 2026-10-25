# Threat model — Molecule Architecture Studio

Phase 2 (security), 2026-10-25. Scope: the Next.js BFF + UI (`src/`), the Express auth-billing service
(`services/auth-billing-service`), the PostgreSQL ledger (`database/init`), Lemon Squeezy and Gemini integrations.
Findings are tracked in [SECURITY_FINDINGS.md](./SECURITY_FINDINGS.md) (`SEC-xx`); earlier fixes in
`docs/testing/FINDINGS.md` (`FINDING-xx`).

## 1. System and data flows

```
Browser ──HTTPS──▶ Next.js (BFF + UI)                       Lemon Squeezy ──HTTPS + HMAC──┐
  │  session_token cookie (httpOnly,                          (hosted checkout, webhooks)  │
  │  Secure, SameSite=Strict)                                                              ▼
  │                       ├─ /api/auth|billing|users/* ──▶ Express auth-billing ◀── POST /api/billing/webhooks/lemonsqueezy
  │                       │   (gateway: Bearer from cookie,  (PUBLIC: reachable from the internet for the webhook)
  │                       │    X-Internal-Service-Key,         │
  │                       │    X-Client-IP)                    ├──▶ PostgreSQL (ledger, users, holds) — single app role today
  │                       ├─ /api/chat ──▶ Express /consume|/capture|/refund (internal key) ; ──▶ Gemini (server key)
  │                       └─ middleware: page gating (JWT signature check)
  └─ Google Identity Services (browser) → id_token → BFF → Express verifies against Google certs
Express ──▶ Resend (verification / reset / receipt mails)
```

## 2. Assets

| Asset | Why it matters | Where |
| --- | --- | --- |
| **Credit ledger and balances** | Credits are bought with money; minting or stealing them is direct financial loss | `credit_ledger_transactions`, `user_balances`, `ai_credit_holds`, `post_credit_transaction()` |
| **Accounts and sessions** | Account takeover exposes purchases, credits, profile data | `users`, JWT (`session_token` cookie), `token_version`, `revoked_tokens` |
| **Account-recovery tokens** | Verification / reset links sign a user in or set a password | `verification_tokens`, `password_reset_tokens` (SHA-256 at rest) |
| **Secrets** | `JWT_SECRET` forges any session; `LEMONSQUEEZY_WEBHOOK_SECRET` forges purchases; `INTERNAL_SERVICE_SECRET` reaches metering; `GEMINI_API_KEY` spends money | env of both services |
| **AI budget** | Every chat turn costs Gemini tokens (real money) and should cost credits | `/api/chat`, Gemini key |
| **Personal data** | Email, name, date of birth, signup IP | `users` |
| **Availability** | Public Express and BFF must keep serving | both services |

## 3. Trust boundaries

1. **Internet → Next.js BFF.** Everything from the browser is untrusted, including headers (`Origin`, `X-Forwarded-*`),
   cookies, paths and bodies.
2. **Internet → Express (direct).** Express is publicly reachable so Lemon can deliver webhooks. Any route is
   reachable without going through the BFF — the BFF's CSRF guard and path filtering do **not** protect Express.
3. **BFF → Express.** Authenticated by `X-Internal-Service-Key` (constant-time compare, 404 when wrong) for the
   metering endpoints and for trusting `X-Client-IP`.
4. **Lemon → Express webhook.** Authenticated only by the HMAC-SHA256 `X-Signature` over the raw body.
5. **Express → PostgreSQL.** Today one database role with owner-level rights; SEC-12 adds a least-privilege app
   role (`database/roles/app-role.sql`, `DB_ROLES.md`) that the owner can switch to.
6. **Google → BFF/Express.** Google ID tokens verified (signature, audience, issuer, expiry, `email_verified`).
7. **Gemini → BFF → browser.** Model output is untrusted content (prompt injection, markup).
8. **Operators / logs.** Logs must not carry tokens, links, passwords (SEC-08 removed the dev mail-logging path in
   production).

## 4. Attackers

| Attacker | Capabilities | Goals |
| --- | --- | --- |
| **Anonymous internet user** | HTTP to the BFF and to Express directly, many IPs, scripts | free credits, account takeover, enumeration, DoS, cost abuse |
| **Registered user** | valid session, own credits | more credits than paid for, other users' data, AI abuse beyond the price |
| **Malicious site (CSRF / clickjacking)** | makes the victim's browser send requests | spend the victim's credits, log in / out the victim, start checkouts |
| **Pre-account attacker** | registers an email before its owner | take over the owner's later account (FINDING-34, SEC-05) |
| **Webhook forger** | can POST to the public webhook URL | mint credits with forged or replayed purchase events |
| **Compromised dependency / CI** | code execution in build or runtime | secret theft, supply-chain persistence (SEC-01, SEC-03, SEC-04) |
| **Insider with log or DB-read access** | reads logs, backups | recovery links, tokens, PII |

## 5. Abuse cases and controls

### 5.1 Credit theft / minting

| Abuse case | Controls (and where verified) |
| --- | --- |
| Forge a purchase webhook | HMAC over raw body, 401 before any DB access; strong webhook secret enforced at startup in production (SEC-08) |
| Replay a genuine webhook | ledger idempotency on `(provider, ls_order_<id>)` (FINDING-11); concurrent replays → `already_processed` |
| Pay for a cheap pack, get an expensive one | amount checked against the server-side package price; currency USD only; variant → pack mapping from env only (FINDING-13) |
| Refund a successful AI turn / pick the ledger type | metering endpoints internal-only (404 without the key), reserve → capture / release (FINDING-03, -07) |
| Overspend with parallel turns | holds count against the available balance under an advisory lock (FINDING-22 tests) |
| Edit balances directly | ledger append-only triggers; balance writes only via `post_credit_transaction()`; reconciliation job (FINDING-05); with the SEC-12 app role the service cannot UPDATE/DELETE/TRUNCATE the money tables, disable triggers or set the guard flag usefully — the owner role still can (SEC-12) |

### 5.2 Account takeover

| Abuse case | Controls |
| --- | --- |
| Credential guessing | bcrypt (cost ≥ 10 in production, SEC-08); 5 attempts / 15 min per IP + normalised email (SEC-06). Open: no per-account limit across IPs (SEC-06, decision) |
| Pre-registering a victim's email | Google sign-in takes over unverified accounts (FINDING-34), including the race window (SEC-05) |
| Stolen / leaked session | httpOnly + SameSite=Strict + Secure cookie (FINDING-24); `token_version` revocation on reset (FINDING-18); logout revokes `jti` |
| Recovery-token theft | 32-byte random tokens, SHA-256 at rest, single use, 24 h / 1 h expiry; links never logged in production (SEC-08) |
| Enumeration as a first step | identical bodies (FINDING-09) and no mail-timing / status signal (SEC-07) |

### 5.3 AI cost abuse (Part 2B covers the AI Lab in depth)

Each turn reserves credits before Gemini is called; per-user rate limit (Upstash or in-memory); timeout releases the
hold. Open for 2B: input size per credit (24 messages × 8,000 chars), global/daily caps, content-policy bypass.

### 5.4 Webhook forgery and abuse

Signature first, then parsing; body limit (256 kb) applied after decompression and before HMAC (SEC-02 verification);
unknown events acknowledged and ignored; malformed payloads logged without credit.

### 5.5 Availability

Body limits on Express (32 kb / 256 kb, verified against decompression bombs); unbounded request buffering in the BFF
(SEC-10); in-memory rate limiters are per instance.

## 6. Assumptions and out of scope

* TLS terminates at the hosting platforms; `CLIENT_IP_HEADER` / `TRUST_PROXY_HOPS` are set to match them (runbook).
* Neon (PostgreSQL 18.6) is reachable only with credentials; backups and PITR are configured (Part 3).
* Lemon Squeezy and Google are trusted for what they sign; Gemini output is not trusted.
* Physical / host compromise, and denial of service beyond application-level limits, are out of scope.
