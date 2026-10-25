/**
 * Pre-deploy configuration check for BOTH services (owner tool; never contacts anything).
 *
 *   npm run check:config -- --service <file|env> --web <file|env>
 *
 * `<file>` is a dotenv file (e.g. a copy of the host's env export); `env` reads this process's
 * environment. Values are compared and validated but NEVER printed — output names variables only.
 * Exit 0 = ready (warnings may be printed), 1 = at least one problem, 64 = usage error.
 *
 * Checks (production rules):
 *  - each side: every boot-time check the service / `next start` would run (SEC-08), reused from
 *    the code itself, plus INTERNAL_SERVICE_SECRET / GEMINI_API_KEY presence and strength;
 *  - any value still equal to its `.env.example` placeholder;
 *  - shared values identical on both sides: INTERNAL_SERVICE_SECRET, JWT_SECRET, FRONTEND_URL, and the
 *    Google client id (service GOOGLE_CLIENT_ID = web NEXT_PUBLIC_GOOGLE_CLIENT_ID) when set;
 *  - AI reservation lifetime: AI_HOLD_TTL_SECONDS (service) must be at least TWICE the longest a turn can
 *    take before its capture lands = GEMINI_TIMEOUT_MS + sum(BILLING_RETRY_DELAYS_MS) (web). The 2× margin
 *    covers the reserve/capture round trips themselves and clock skew; below it a slow but successful
 *    turn can find its hold expired and go uncharged.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  aiHoldTtlSeconds,
  isProductionNodeEnv,
  productionConfigProblems,
} from "../services/auth-billing-service/src/config/productionConfig";
import { weakSecretReason as serviceSecretReason } from "../services/auth-billing-service/src/config/secretStrength";
import { bffProductionConfigProblems } from "../src/instrumentation";
import { geminiTimeoutMs } from "../src/lib/ai/gemini-timeout";
import { retryDelays } from "../src/lib/billing/server-billing";
import { weakSecretReason as webSecretReason } from "../src/lib/security/secret-strength";

type Env = Record<string, string | undefined>;
export const TTL_MARGIN = 2;
/** Secrets, keys, ids, URLs and senders: an `.env.example` value here can only be a placeholder. */
const PER_DEPLOYMENT = /(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|_URL|_ID|EMAIL|_FROM|VARIANT)/;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Snapshot before anything else can touch process.env.
const processEnv: Env = { ...process.env };

function usage(message: string): never {
  console.error(`[check:config] ${message}`);
  console.error("Usage: npm run check:config -- --service <file|env> --web <file|env>");
  process.exit(64);
}

function readArgs(argv: string[]): { service: string; web: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key !== "--service" && key !== "--web") usage(`Unknown argument ${JSON.stringify(key)}.`);
    const value = argv[++i];
    if (!value) usage(`${key} needs a file path or "env".`);
    out[key.slice(2)] = value;
  }
  if (!out.service || !out.web) usage("Both --service and --web are required.");
  return { service: out.service, web: out.web };
}

function load(spec: string, side: string): Env {
  if (spec === "env") return processEnv;
  const file = path.resolve(spec);
  if (!fs.existsSync(file)) usage(`${side} env file not found: ${spec}`);
  try {
    return parseEnv(fs.readFileSync(file, "utf8")) as Env;
  } catch {
    usage(`${side} env file could not be parsed as dotenv: ${spec}`);
  }
}

function exampleValues(relative: string): Env {
  const file = path.join(repoRoot, relative);
  return fs.existsSync(file) ? (parseEnv(fs.readFileSync(file, "utf8")) as Env) : {};
}

const trimmed = (v: string | undefined) => v?.trim() ?? "";
const sameOrigin = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export function checkConfig(service: Env, web: Env, examples = { service: exampleValues("services/auth-billing-service/.env.example"), web: exampleValues(".env.example") }) {
  const problems: string[] = [];
  const warnings: string[] = [];
  const add = (side: string, list: Array<string | null>) =>
    list.forEach((p) => p && problems.push(`${side}: ${p}`));

  // ── Service (Express) ─────────────────────────────────────────────────────
  if (!isProductionNodeEnv(service.NODE_ENV)) {
    problems.push(`service: NODE_ENV is "${trimmed(service.NODE_ENV)}" — dev rules (mailed links logged, dev CORS). Set NODE_ENV=production.`);
  }
  add("service", productionConfigProblems(service as NodeJS.ProcessEnv));
  add("service", [
    serviceSecretReason("JWT_SECRET", service.JWT_SECRET),
    serviceSecretReason("INTERNAL_SERVICE_SECRET", service.INTERNAL_SERVICE_SECRET),
    trimmed(service.DATABASE_URL) || trimmed(service.DB_HOST) ? null : "DATABASE_URL is not set.",
  ]);
  if (!trimmed(service.HOST)) warnings.push("service: HOST is not set — production binds 127.0.0.1 (hosted platforms need HOST=0.0.0.0).");
  if (!trimmed(service.GOOGLE_CLIENT_ID)) warnings.push("service: GOOGLE_CLIENT_ID is not set — Google sign-in answers 503.");

  // ── Web (Next.js BFF) ─────────────────────────────────────────────────────
  add("web", bffProductionConfigProblems(web as NodeJS.ProcessEnv));
  add("web", [
    webSecretReason("INTERNAL_SERVICE_SECRET", web.INTERNAL_SERVICE_SECRET),
    trimmed(web.GEMINI_API_KEY) ? null : "GEMINI_API_KEY is not set — every AI Lab turn answers 503.",
  ]);
  if (!trimmed(web.CLIENT_IP_HEADER)) warnings.push("web: CLIENT_IP_HEADER is not set — all users share one rate-limit bucket (runbook §5).");

  // ── Placeholders copied from .env.example ─────────────────────────────────
  for (const [side, values, example] of [
    ["service", service, examples.service],
    ["web", web, examples.web],
  ] as const) {
    for (const [name, placeholder] of Object.entries(example)) {
      // Only values that must differ per deployment; tuning knobs may legitimately keep their example default.
      if (!PER_DEPLOYMENT.test(name)) continue;
      const value = trimmed(values[name]);
      if (value && trimmed(placeholder) && value === trimmed(placeholder)) {
        problems.push(`${side}: ${name} still has its .env.example placeholder value.`);
      }
    }
  }

  // ── Values both sides must share ──────────────────────────────────────────
  for (const name of ["INTERNAL_SERVICE_SECRET", "JWT_SECRET"]) {
    if (trimmed(service[name]) && trimmed(web[name]) && trimmed(service[name]) !== trimmed(web[name])) {
      problems.push(`${name} differs between service and web — ${name === "JWT_SECRET" ? "no session would verify" : "every metering call is refused"}.`);
    }
  }
  if (trimmed(service.FRONTEND_URL) && trimmed(web.FRONTEND_URL) && !sameOrigin(trimmed(service.FRONTEND_URL), trimmed(web.FRONTEND_URL))) {
    problems.push("FRONTEND_URL differs between service and web — mail links / checkout redirects and the CSRF origin disagree.");
  }
  const googleService = trimmed(service.GOOGLE_CLIENT_ID);
  const googleWeb = trimmed(web.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  if (googleService && googleWeb && googleService !== googleWeb) {
    problems.push("GOOGLE_CLIENT_ID (service) differs from NEXT_PUBLIC_GOOGLE_CLIENT_ID (web) — every Google sign-in fails audience verification.");
  }

  // ── Hold lifetime vs the longest turn ─────────────────────────────────────
  const ttlMs = aiHoldTtlSeconds(service as NodeJS.ProcessEnv) * 1000;
  const turnMs = geminiTimeoutMs(web as NodeJS.ProcessEnv) + retryDelays(web as NodeJS.ProcessEnv).reduce((a, b) => a + b, 0);
  if (ttlMs < TTL_MARGIN * turnMs) {
    problems.push(
      `AI_HOLD_TTL_SECONDS (${ttlMs / 1000} s) must be at least ${TTL_MARGIN}× GEMINI_TIMEOUT_MS + sum(BILLING_RETRY_DELAYS_MS) ` +
        `(${turnMs / 1000} s → ≥ ${Math.ceil((TTL_MARGIN * turnMs) / 1000)} s), or slow successful turns go uncharged.`,
    );
  }

  return { problems, warnings, ttlMs, turnMs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = readArgs(process.argv.slice(2));
  const result = checkConfig(load(args.service, "service"), load(args.web, "web"));
  for (const w of result.warnings) console.log(`warning  ${w}`);
  for (const p of result.problems) console.log(`PROBLEM  ${p}`);
  console.log(
    `[check:config] hold TTL ${result.ttlMs / 1000} s vs longest turn ${result.turnMs / 1000} s (margin required: ${TTL_MARGIN}×)`,
  );
  if (result.problems.length > 0) {
    console.log(`[check:config] ${result.problems.length} problem(s) — not ready for production.`);
    process.exitCode = 1;
  } else {
    console.log("[check:config] OK — no problems found.");
  }
}
