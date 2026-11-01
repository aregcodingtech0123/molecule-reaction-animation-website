import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_JWT_SECRET, WEB_ORIGIN, repoRoot } from "../../scripts/test/e2e-env.mjs";

/**
 * Page gating for /dashboard, /ai-lab and /profile (Phase 2, Part 0).
 *
 * Requests are sent with node:http so paths go out byte-for-byte (no URL normalisation of
 * "..", "//" or percent-escapes) and redirects are followed by hand. The only acceptable
 * outcomes are a redirect to /login or a 4xx — never a 200 for a protected route.
 *
 * Covers the middleware-bypass families published for Next.js (GHSA-6gpp-xcg3-4w24 needs a
 * single-entry i18n config, which this app does not have; CVE-2025-29927 used
 * x-middleware-subrequest) plus path-normalisation and internal-header tricks.
 */
const PROTECTED = ["/dashboard", "/ai-lab", "/profile"] as const;
const web = new URL(WEB_ORIGIN);

interface Hop {
  path: string;
  status: number;
  location: string | null;
}

function rawGet(rawPath: string, headers: Record<string, string>): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: web.hostname, port: web.port, method: "GET", path: rawPath, headers: { host: web.host, ...headers } },
      (res) => {
        res.resume();
        // Data/RSC requests get the middleware redirect in x-nextjs-redirect instead of Location.
        const redirect = res.headers.location ?? (res.headers["x-nextjs-redirect"] as string | undefined) ?? null;
        res.on("end", () => resolve({ path: rawPath, status: res.statusCode ?? 0, location: redirect }));
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error(`timeout ${rawPath}`)));
    req.end();
  });
}

/** Follow up to 5 redirects (same headers); stop as soon as one points at /login. */
async function outcome(rawPath: string, headers: Record<string, string> = {}): Promise<{ verdict: "login" | "client-error" | "OPEN"; hops: Hop[] }> {
  const hops: Hop[] = [];
  let current = rawPath;
  for (let i = 0; i < 5; i++) {
    const hop = await rawGet(current, headers);
    hops.push(hop);
    if (hop.status >= 300 && hop.status < 400 && hop.location) {
      const next = new URL(hop.location, WEB_ORIGIN);
      if (next.pathname === "/login") return { verdict: "login", hops };
      current = next.pathname + next.search;
      continue;
    }
    if (hop.status >= 400 && hop.status < 500) return { verdict: "client-error", hops };
    return { verdict: "OPEN", hops };
  }
  return { verdict: "OPEN", hops };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(payload: Record<string, unknown>, opts: { secret?: string; alg?: string } = {}) {
  const header = b64({ alg: opts.alg ?? "HS256", typ: "JWT" });
  const body = b64(payload);
  if (opts.alg === "none") return `${header}.${body}.`;
  const sig = createHmac("sha256", opts.secret ?? E2E_JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: "11111111-1111-4111-8111-111111111111",
  email: "nobody@example.test",
  iss: "moleculestudio-auth-billing",
  aud: "moleculestudio-api",
  iat: now(),
  exp: now() + 3600,
  tv: 0,
  ...extra,
});

function pathVariants(p: string): string[] {
  const first = p[1]!;
  return [
    p,
    `${p}/`,
    `${p}/anything`,
    `${p}?__nextDataReq=1`,
    `${p}?_rsc=abc`,
    `${p}.rsc`,
    `${p}.json`,
    `${p}%2F`,
    `${p}%2Fanything`,
    `/%${first.charCodeAt(0).toString(16)}${p.slice(2)}`,
    `/%${first.charCodeAt(0).toString(16).toUpperCase()}${p.slice(2)}`,
    `/${p}`,
    `/.${p}`,
    `/x/..${p}`,
    `/x/%2e%2e${p}`,
    `${p}/.`,
    `${p};x=1`,
    `${p}%00`,
    p.toUpperCase(),
    `/en${p}`,
    `/_next/data/development${p}.json`,
    `/index${p}`,
  ];
}

const HEADER_TRICKS: Array<[string, Record<string, string>]> = [
  ["x-middleware-subrequest: middleware", { "x-middleware-subrequest": "middleware" }],
  ["x-middleware-subrequest: src/middleware", { "x-middleware-subrequest": "src/middleware" }],
  ["x-middleware-subrequest ×5", { "x-middleware-subrequest": Array(5).fill("middleware").join(":") }],
  ["x-middleware-subrequest ×5 (src/)", { "x-middleware-subrequest": Array(5).fill("src/middleware").join(":") }],
  ["x-nextjs-data", { "x-nextjs-data": "1" }],
  ["RSC flight request", { rsc: "1", "next-router-state-tree": "%5B%22%22%5D" }],
  ["router prefetch", { rsc: "1", "next-router-prefetch": "1" }],
  ["purpose: prefetch", { purpose: "prefetch", "x-middleware-prefetch": "1" }],
  ["x-invoke-path", { "x-invoke-path": "/dashboard", "x-invoke-query": "{}" }],
  ["x-matched-path", { "x-matched-path": "/dashboard" }],
  ["x-now-route-matches", { "x-now-route-matches": "1" }],
  ["next-action", { "next-action": "0000000000000000000000000000000000000000" }],
  ["x-forwarded-host/proto", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }],
];

const COOKIE_TRICKS: Array<[string, string]> = [
  ["garbage", "not-a-jwt"],
  ["alg none", jwt(claims(), { alg: "none" })],
  ["other secret", jwt(claims(), { secret: "attacker-secret-0123456789abcdefghijkl" })],
  ["expired", jwt(claims({ exp: now() - 60, iat: now() - 3600 }))],
  ["wrong audience", jwt(claims({ aud: "someone-else" }))],
  ["no tv claim (pre-FINDING-18 token)", jwt(claims({ tv: undefined }))],
  ["no sub", jwt(claims({ sub: undefined }))],
];

test.describe("page gating — no valid session never reaches a protected page", () => {
  test.describe.configure({ timeout: 600_000 });

  for (const p of PROTECTED) {
    test(`${p}: path-normalisation variants`, async () => {
      const results = [];
      for (const variant of pathVariants(p)) results.push({ variant, ...(await outcome(variant)) });
      const open = results.filter((r) => r.verdict === "OPEN");
      expect(open, JSON.stringify(open, null, 1)).toEqual([]);
      // The plain path itself must redirect to /login (not merely 404).
      expect(results[0]!.verdict).toBe("login");
    });

    test(`${p}: internal / middleware-bypass headers`, async () => {
      const results = [];
      for (const [label, headers] of HEADER_TRICKS) {
        for (const variant of [p, `${p}/`, `${p}?_rsc=abc`]) results.push({ label, variant, ...(await outcome(variant, headers)) });
      }
      const open = results.filter((r) => r.verdict === "OPEN");
      expect(open, JSON.stringify(open, null, 1)).toEqual([]);
    });

    test(`${p}: forged or stale session cookies`, async () => {
      const results = [];
      for (const [label, token] of COOKIE_TRICKS) {
        results.push({ label, ...(await outcome(p, { cookie: `session_token=${token}` })) });
        results.push({ label: `${label} + bypass header`, ...(await outcome(p, { cookie: `session_token=${token}`, "x-middleware-subrequest": "middleware" })) });
      }
      const open = results.filter((r) => r.verdict === "OPEN");
      expect(open, JSON.stringify(open, null, 1)).toEqual([]);
    });
  }
});

test.describe("defence in depth — data behind the protected pages needs a session server-side", () => {
  test("every API the protected pages call answers 401 without a session (even with bypass headers)", async ({ request }) => {
    const bypass = { "x-middleware-subrequest": Array(5).fill("middleware").join(":") };
    const calls: Array<[string, string, object?]> = [
      ["GET", "/api/auth/me"],
      ["GET", "/api/billing/balance"],
      ["GET", "/api/billing/history"],
      ["GET", "/api/billing/operation-costs"],
      ["GET", "/api/users/profile"],
      ["PUT", "/api/users/profile", { firstName: "X" }],
      ["POST", "/api/billing/checkout", { packageId: "starter" }],
      ["POST", "/api/chat", { messages: [{ role: "user", content: "hi" }] }],
    ];
    const statuses: Record<string, number> = {};
    for (const [method, url, data] of calls) {
      for (const headers of [{}, bypass]) {
        const res = await request.fetch(url, { method, headers, data });
        statuses[`${method} ${url}${Object.keys(headers).length ? " +bypass" : ""}`] = res.status();
      }
    }
    expect(Object.entries(statuses).filter(([, s]) => s !== 401)).toEqual([]);
  });

  test("protected pages are client components: no user data is rendered on the server", () => {
    for (const p of PROTECTED) {
      const file = path.join(repoRoot, "src/app", p, "page.tsx");
      const source = fs.readFileSync(file, "utf8");
      expect(source.trimStart().startsWith('"use client"'), file).toBe(true);
      // Server-only data access would make a middleware bypass leak data; there must be none.
      expect(source, file).not.toMatch(/from ["']next\/headers["']|server-only|@\/lib\/db|process\.env\.(?!NEXT_PUBLIC_)/);
    }
    // A protected section may have a layout only for its (static) metadata (SEO-04): a pass-through with no data access.
    for (const d of fs.readdirSync(path.join(repoRoot, "src/app")).filter((d) => PROTECTED.includes(`/${d}` as never))) {
      const layout = path.join(repoRoot, "src/app", d, "layout.tsx");
      if (!fs.existsSync(layout)) continue;
      const source = fs.readFileSync(layout, "utf8");
      expect(source, layout).not.toMatch(/next\/headers|server-only|@\/lib\/db|process\.env|fetch\(|cookies\(/);
      const imports = [...source.matchAll(/^import .* from ["'](.+)["'];?\s*$/gm)].map((m) => m[1]);
      expect(imports, layout).toEqual(["@/lib/seo/metadata"]);
      expect(source, layout).toContain(`export const generateMetadata = routeMetadata("/${d}");`);
      expect(source, layout).toContain("return children;");
    }
  });
});
