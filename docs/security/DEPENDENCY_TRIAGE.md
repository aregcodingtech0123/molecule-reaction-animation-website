# Dependency triage — Phase 2, Part 1

Branch `security/deps-and-ci`, 2026-10-25. Starting point: `main` after the Next.js 16.4.3 upgrade (SEC-01).
Method: `npm audit --json` (full tree and `--omit=dev`), `npm ls` / `npm explain` for each chain, the advisory text for
the precondition, and the code for whether that precondition can occur here. All fixes are lockfile updates **within
the declared ranges** (`npm update <names>`); no `package.json` range changed, no `npm audit fix --force`.

## Result

| Package | Before | After |
| --- | --- | --- |
| `services/auth-billing-service` | 3 (1 critical, 1 high, 1 moderate) | **0** |
| root (Next.js app) | 25 (3 critical, 12 high, 5 moderate, 5 low) | **4 low** (the KaTeX chain — decision needed, below). **Now: 3 moderate**, dev-only (autocannon, below); the KaTeX chain is gone (KaTeX removed, R15) |

"Runtime" below means code that runs in the deployed Next.js server or browser bundle or in Express. "Reachable"
means an attacker-controlled input can meet the advisory's precondition in this project.

## Service (Express — publicly reachable) — SEC-02

| Advisory | Package (chain) | Runtime? | Reachable here? | Action |
| --- | --- | --- | --- | --- |
| GHSA-27r3-jxmh-p828 (High) | body-parser 2.3.0 (express 5.2.1 → body-parser) | yes | **yes** — compressed request bodies are parsed before routing (`express.json` global, `express.raw` on the webhook) | 2.4.0 |
| GHSA-jqcg-44mw-7w3h (Critical) | proxy-addr 2.0.7 (express → proxy-addr) | yes | no — needs an IPv6 trust subnet with zero leading bits; `trust proxy` is a hop count (`TRUST_PROXY_HOPS`) | 2.0.8 |
| GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx (Moderate) | qs 6.15.2 (express, body-parser; supertest dev) | yes | no — no `urlencoded` parser; Express 5's default query parser is the simple one | 6.16.1 |

Regression guard: `services/auth-billing-service/tests/unit/dependency-floors.test.ts`.

## Root package — the three critical advisories

| # | Advisory | Package and chain | Runtime or tooling | Reachable? | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | shell-quote: `quote()` command injection via a line terminator | `concurrently` (devDependency) → `shell-quote` 1.9.0 | **dev tooling only** — `npm run dev:all` | no — `concurrently` only quotes the fixed literal commands in `package.json` | shell-quote 1.12.0, concurrently 9.2.5 |
| 2 | (same, reported on the direct dependency) | `concurrently` 9.2.4 | dev tooling only | no | as #1 |
| 3 | proxy-addr GHSA-jqcg-44mw-7w3h | `@google/genai` → `@modelcontextprotocol/sdk` → `express` 5.2.1 → `proxy-addr` 2.0.7 | installed with a runtime dependency, but **never executed**: `/api/chat` only calls `GoogleGenAI.models.generateContent`; the MCP SDK's Express server transport is never started | no (and the IPv6-subnet precondition does not apply) | proxy-addr 2.0.8 |

## Root package — high, moderate, low (fixed within range)

| Advisory package | Chain | Runtime or tooling | Reachable? | After |
| --- | --- | --- | --- | --- |
| @modelcontextprotocol/sdk (high) | `@google/genai` → MCP SDK | runtime dep, MCP features unused | no | 1.32.2 |
| body-parser (high), qs (moderate) | `@google/genai` → MCP SDK → express | not executed | no | 2.4.0 / 6.16.1 |
| hono (high), @hono/node-server (moderate) | `@google/genai` → MCP SDK → @hono/node-server | not executed | no | 4.13.14 / 2.1.5 |
| fast-uri (high) | `@google/genai` → MCP SDK → ajv-formats → ajv | not executed | no | 3.1.9 |
| ws (high), protobufjs (high) | `@google/genai` | runtime library; Live/WebSocket and protobuf paths unused (REST `generateContent` only) | no | 8.22.0 / 7.6.6 |
| shadcn (high, via its nested zod), zod (high) | `shadcn` (dependency; CLI + `shadcn/tailwind.css`) | CLI is tooling; only `tailwind.css` ships | no | 4.22.1 / 4.6.7 |
| ip-address (high), postcss-selector-parser (moderate), @babel/core (low) | `shadcn` CLI (socks, postcss, babel) | tooling | no | 10.7.5 / 7.1.7 / 7.29.7 |
| brace-expansion (high) | `shadcn` → ts-morph; `eslint-config-next` → typescript-estree | tooling | no | 5.0.12 / 1.1.21 |
| js-yaml (high) | `eslint` → @eslint/eslintrc | tooling | no | 4.3.2 |
| browserslist (high), baseline-browser-mapping (moderate) | `@babel/core`, Next.js build | build tooling | no | 4.29.4 / 2.11.32 |
| fflate (moderate) | `@react-three/drei`, `three-stdlib`, `@react-three/postprocessing` | browser bundle | no — used for loading bundled assets; no user-supplied ZIPs are parsed | 0.8.3 / 0.6.11 |

**`shadcn` 4.7.0 → 4.22.1 changes shipped CSS.** `src/app/globals.css` imports `shadcn/tailwind.css`. Diffing the
two versions: lines 1–95 are identical; 4.22.1 only appends `scroll-fade-*` / `shimmer-*` Tailwind utilities (emitted
only when a class uses them), `@property` declarations and one `.shimmer` rule under `prefers-reduced-motion`. No file
in `src/` uses `shimmer` or `scroll-fade`, so rendering is unchanged.

## Root package — KaTeX chain (4 low) — **resolved: KaTeX removed** (owner decision R15, performance phase, 2026-10-26)

`katex`, `rehype-katex` and `remark-math` (and with it `micromark-extension-math`) were uninstalled; AI answers show
maths as source text in monospace (`src/lib/ai/math-as-code.ts`). `npm audit` no longer reports
GHSA-238p-pmpm-9mq7. The analysis below is kept for the record.

### Before R15 — accepted and tracked (owner decision, 2026-10-25)

> **Re-check trigger:** any new release of `rehype-katex` or `micromark-extension-math` (check whether its
> `katex` dependency range reaches ≥ 0.18.2), or a new KaTeX advisory. Until then the advisory stays accepted:
> not reachable without a separate prototype-pollution bug, and every available change breaks chat math styling.

| Advisory | GHSA-238p-pmpm-9mq7 (Low): "Existing prototype pollution can bypass trust restrictions", `katex` ≥ 0.11.0 < 0.18.2 |
| --- | --- |
| Installed | `katex` 0.17.0 (direct; only for `katex/dist/katex.min.css`); `katex` 0.16.47 nested under `rehype-katex` 7.0.1 and `remark-math` 6.0.0 → `micromark-extension-math` 3.1.0 |
| Used by | `src/components/ai/ChatMessageContent.tsx`: AI chat answers rendered with `remark-math` + `rehype-katex` (default options, `trust` off), then `rehype-sanitize` |
| Reachable? | Not in practice: requires a **pre-existing** prototype-pollution primitive in the page plus a `trust` setting; none is known here |
| Fix availability | **None within the plugins**: the latest `rehype-katex` (7.0.1) and `micromark-extension-math` (3.1.0) still declare `katex ^0.16.0`. npm's suggested "fix" is to *downgrade* `remark-math` to 3.0.1 and `rehype-katex` to 1.2.0 (several majors back, incompatible with unified 11 / react-markdown) |

What each option would break:

1. **Bump only the direct `katex` to 0.19.1.** The renderer stays 0.16 (nested), but the stylesheet would come from
   0.19. KaTeX **0.18.0 prefixed its CSS class names** ("users who apply custom styles or have allowlists targeting
   KaTeX's internal classes must update their selectors"), so 0.19 CSS would not match 0.16 markup → **math in AI chat
   renders unstyled**. Also leaves the vulnerable nested copies in place.
2. **Force `katex` 0.19.1 everywhere with `overrides`.** The renderer would emit prefixed classes: our own selectors in
   `globals.css` (`.chat-markdown .katex`, `.katex .mord`, `.mop`, `.mbin`, `.mrel`, `.mopen`, `.mclose`, around lines
   447–470) would stop matching → light-theme math colours break until rewritten. `rehype-katex` and
   `micromark-extension-math` would run outside their declared peer range (`^0.16`). Other changes in 0.18–0.19:
   invalid environments throw a ParseError (0.18.4), strict-mode reporting changes (0.19.0), font fallback order (0.18.10).
3. **Follow npm's downgrade suggestion.** Breaks rendering entirely (plugin generations incompatible with the current
   unified/react-markdown stack).
4. **Accept and track (recommended for now).** Low severity, not reachable without a separate prototype-pollution
   bug; revisit when `rehype-katex` / `micromark-extension-math` move to `katex` ≥ 0.18.2.

## Root package — autocannon chain (3 moderate) — accepted (performance phase, 2026-10-26)

`autocannon` 8.0.0 was added as an exact-pinned **devDependency** (owner-approved, Part 1 of the performance phase)
to cross-check the in-repo load driver (`scripts/perf/scenarios/crosscheck.mjs`). 8.0.0 is the latest release
(2024-10-14). It brings one advisory, reported three times along its chain:

| Advisory | Chain | Runtime or tooling | Reachable? | Action |
| --- | --- | --- | --- | --- |
| GHSA-w5hq-g745-h8pq (moderate): uuid < 11.1.1, missing buffer bounds check in `v3`/`v5`/`v6` when `buf` is passed | `autocannon` 8.0.0 → `hyperid` 3.3.0 → `uuid` 8.3.2 | **dev tooling only** — local benchmarks; never in the Next build or Express | no — `hyperid` uses `crypto.randomUUID` (falls back to `uuid.v4` only on runtimes without it); `v3`/`v5`/`v6` are never called | accepted; npm's only offered fix is a downgrade to autocannon 2.0.1 |

> **Re-check trigger:** a new `autocannon` or `hyperid` release, or removal of the cross-check.

## ESLint — pre-existing errors (not fixed in this phase)

`eslint .` now ignores generated output (`.next-e2e/`, coverage, Playwright reports, compiled service). On this branch
before the legacy-service removal: 403 files, 31 errors, 23 warnings. The CI `lint` job reports them but does not fail
the build (`continue-on-error: true`).

**React Compiler rules (`eslint-plugin-react-hooks` 7.1.1, unchanged by the Next.js upgrade) — 27 errors**

| Rule | Count | Locations |
| --- | --- | --- |
| `react-hooks/set-state-in-effect` | 20 | `src/app/explore/page.tsx:85`, `:99`; `src/app/profile/page.tsx:101`; `src/app/verify-email/page.tsx:61`; `src/components/auth/AuthGatePage.tsx:40`; `src/components/auth/AuthModal.tsx:80`; `src/components/canvas/MoleculeViewer.tsx:62`; `src/components/canvas/Scene.tsx:167`; `src/components/home/HomeMoleculePreview.tsx:71`, `:78`; `src/components/layout/LanguageSelector.tsx:33`; `src/components/layout/Navbar.tsx:56`; `src/components/onboarding/WelcomeModal.tsx:67`, `:72`; `src/components/reactions/ReactionStage.tsx:126`; `src/context/AuthContext.tsx:248`; `src/context/ExploreSidebarContext.tsx:28`; `src/context/LanguageContext.tsx:41`; `src/context/ThemeContext.tsx:54`; `src/lib/periodic-table/useElementRealWorldView.ts:28` |
| `react-hooks/refs` | 4 | `src/hooks/useBalanceAutoRefresh.ts:41`, `:42`; `src/hooks/useCheckoutSuccess.ts:66`, `:67` |
| `react-hooks/preserve-manual-memoization` | 1 | `src/app/profile/page.tsx:159` |
| `react-hooks/immutability` | 1 | `src/components/canvas/CanvasRaycasterConfig.tsx:16` |
| `react-hooks/globals` | 1 | `tests/unit/auth/AuthContext.test.tsx:21` |

**Other errors — 4** (2 disappear with the legacy-service removal)

| Rule | Locations |
| --- | --- |
| `@typescript-eslint/no-namespace` | `services/auth-billing-service/src/app.ts:13`, `services/auth-billing-service/src/types/index.ts:14` (the `declare global { namespace Express }` request augmentation — the standard Express typing pattern; can be allowed with `allowDeclarations: true`); `services/auth-service/…`, `services/billing-service/…` (removed) |

Warnings (23): `import/no-anonymous-default-export` 12, `@typescript-eslint/no-unused-vars` 10, `react-hooks/exhaustive-deps` 1.
