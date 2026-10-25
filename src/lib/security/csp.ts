/**
 * Content-Security-Policy for every page (Part 2B, owner decision: strict nonce CSP).
 *
 * Scripts: only this request's nonce, plus scripts those load ('strict-dynamic' — e.g. Google Identity
 * Services, injected by GoogleSignInButton). No 'unsafe-inline': an injected <script> or event handler
 * does not run. Next.js applies the nonce to its own scripts during server rendering, which is why every
 * page is rendered per request (the root layout reads the nonce).
 *
 * Styles keep 'unsafe-inline': React / framer-motion / R3F set inline style attributes, and CSS
 * injection is not script execution. Third parties are listed by purpose:
 *  - Google Identity Services (Google's documented values): gsi/style, gsi/ iframes and endpoints
 *  - PubChem (3D structures for AI-suggested molecules), Wikipedia (element summaries + images)
 */
export type CspMode = "enforce" | "report-only";

const GSI = "https://accounts.google.com/gsi/";

export function buildContentSecurityPolicy(opts: { nonce: string; isDev: boolean; upgradeInsecureRequests: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React uses eval only in development (server error stacks); never in production.
    "script-src": ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", `${GSI}style`],
    "img-src": ["'self'", "data:", "blob:", "https://upload.wikimedia.org"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https://pubchem.ncbi.nlm.nih.gov", "https://en.wikipedia.org", GSI],
    "frame-src": [GSI],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (opts.upgradeInsecureRequests) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** CSP_MODE=report-only is the operator's escape hatch if a third party breaks; anything else enforces. */
export function cspMode(source: NodeJS.ProcessEnv = process.env): CspMode {
  return source.CSP_MODE?.trim().toLowerCase() === "report-only" ? "report-only" : "enforce";
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** 128 bits from the platform CSPRNG, base64 (Web Crypto: available in the proxy runtime and in Node). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
