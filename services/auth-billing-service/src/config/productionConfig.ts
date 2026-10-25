import { lemonVariantConfigProblem } from "./env.js";
import { weakSecretReason } from "./secretStrength.js";

/** Resend's shared sandbox sender: it only delivers to the Resend account owner. */
const SANDBOX_SENDER = /@resend\.dev\b/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PLACEHOLDERS = new Set(["your_api_key", "your_store_id", "your_webhook_secret", "changeme", "replace-me"]);

function frontendUrlProblem(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return "FRONTEND_URL is not set (the public origin of the site, e.g. https://studio.example).";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "FRONTEND_URL must be an absolute URL such as https://studio.example.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return "FRONTEND_URL must use https (http is accepted for localhost only).";
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return "FRONTEND_URL must be an origin only (scheme://host[:port]), without a path, query or fragment.";
  }
  return null;
}

function requiredValue(name: string, raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return `${name} is not set.`;
  if (PLACEHOLDERS.has(value.toLowerCase())) return `${name} is a placeholder value from .env.example.`;
  return null;
}

/**
 * Every reason this configuration must not serve production traffic (empty = fine). Checked at
 * startup whenever production rules apply (see isProductionNodeEnv), so a misconfigured deploy
 * fails immediately with the full list instead of failing open or silently later (SEC-08).
 * JWT_SECRET and INTERNAL_SERVICE_SECRET are checked separately, in every mode.
 */
export function productionConfigProblems(source: NodeJS.ProcessEnv = process.env): string[] {
  const problems: Array<string | null> = [
    frontendUrlProblem(source.FRONTEND_URL),
    // Anyone who knows (or guesses) this secret can forge purchase webhooks and mint credits.
    weakSecretReason("LEMONSQUEEZY_WEBHOOK_SECRET", source.LEMONSQUEEZY_WEBHOOK_SECRET),
    requiredValue("LEMONSQUEEZY_API_KEY", source.LEMONSQUEEZY_API_KEY),
    /^\d+$/.test(source.LEMONSQUEEZY_STORE_ID?.trim() ?? "")
      ? null
      : "LEMONSQUEEZY_STORE_ID must be a numeric Lemon Squeezy store id.",
    lemonVariantConfigProblem(source),
    requiredValue("RESEND_API_KEY", source.RESEND_API_KEY),
  ];

  const sender = source.SENDER_EMAIL?.trim() || source.EMAIL_FROM?.trim();
  if (!sender) {
    problems.push("SENDER_EMAIL is not set (verification and reset mails need a verified sender domain).");
  } else if (SANDBOX_SENDER.test(sender)) {
    problems.push("SENDER_EMAIL uses Resend's sandbox address (…@resend.dev), which only delivers to the account owner.");
  }

  const rounds = source.BCRYPT_ROUNDS?.trim();
  if (rounds && !(/^\d+$/.test(rounds) && Number(rounds) >= 10 && Number(rounds) <= 15)) {
    problems.push("BCRYPT_ROUNDS must be an integer between 10 and 15 (default 10).");
  }

  return problems.filter((p): p is string => p !== null);
}
