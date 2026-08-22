import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// SECURITY-TODO: Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in production
// for distributed rate limiting across multiple Next.js instances.
let rateLimiter: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  rateLimiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "ratelimit:chat",
  });
}

export async function checkChatRateLimit(
  userId: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!rateLimiter) {
    return { allowed: true, retryAfter: 0 };
  }

  const { success, reset } = await rateLimiter.limit(userId);
  if (success) {
    return { allowed: true, retryAfter: 0 };
  }

  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { allowed: false, retryAfter };
}
