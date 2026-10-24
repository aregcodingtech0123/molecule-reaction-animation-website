import { isIP } from "node:net";

/**
 * The end user's IP as seen by the platform in front of Next.js (FINDING-04).
 *
 * CLIENT_IP_HEADER names a header the platform SETS (and clients cannot forge):
 *   - Vercel: x-forwarded-for (overwritten by the edge)  - nginx: x-real-ip
 *   - Cloudflare: cf-connecting-ip
 * The right-most valid address is used, because proxies append and any
 * client-supplied entries are further left. Unset → no client IP is forwarded
 * (all BFF traffic then shares one rate-limit bucket at the service).
 */
export function resolveClientIp(request: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  const headerName = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!headerName) return null;
  const raw = request.headers.get(headerName);
  if (!raw) return null;
  const candidates = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => isIP(v) !== 0);
  return candidates.at(-1) ?? null;
}
