/**
 * Mixed production-like traffic for Part 3 (ramp, soak, failure injection). Each arrival index maps
 * deterministically to one kind, by weight (per 100 arrivals):
 *   page 35     anonymous HTML: /, /explore, /periodic-table, /pricing, /login (dynamic, nonce CSP)
 *   balance 25  signed-in GET /api/billing/balance (dashboard header, post-checkout poll)
 *   history 10  signed-in GET /api/billing/history (first page)
 *   chat 10     signed-in POST /api/chat (mock Gemini; reserve → model → capture)
 *   login 8     POST /api/auth/login (bcrypt cost 10), every attempt from its own client IP
 *   checkout 6  signed-in POST /api/billing/checkout (Lemon API mocked in the server preload)
 *   webhook 6   signed Lemon `order_created` straight to Express (unique order id → credits)
 * Users rotate over the seeded accounts (1..N); every arrival carries its own client IP, as a platform proxy
 * would forward it, so per-IP limiters see many clients.
 *
 * `target: "api"` sends the same mix straight to Express, as the BFF would (no pages): Bearer reads, the
 * chat turn's metering pair (internal consume → capture, without the model wait), login, checkout and the
 * webhook. That finds a single Express's own limit, which the BFF hides when Next saturates first.
 */
import { createHmac, randomUUID } from "node:crypto";
import { PERF_PASSWORD, PERF_VARIANTS } from "../config.mjs";
import { apiRequest, browserRequest, clientIp } from "./requests.mjs";

export const MIX = [
  ["page", 35],
  ["balance", 25],
  ["history", 10],
  ["chat", 10],
  ["login", 8],
  ["checkout", 6],
  ["webhook", 6],
];

const PAGES = ["/", "/explore", "/periodic-table", "/pricing", "/login"];
const STORE_ID = 33333; // config.mjs apiEnv LEMONSQUEEZY_STORE_ID

/** Interleaved sequence of kinds (not blocks): spreads each kind evenly over every 100 arrivals. */
function interleave(mix) {
  const seq = [];
  const credit = Object.fromEntries(mix.map(([k]) => [k, 0]));
  const total = mix.reduce((a, [, w]) => a + w, 0);
  for (let i = 0; i < total; i++) {
    for (const [k, w] of mix) credit[k] += w;
    const [best] = mix.reduce((b, [k]) => (credit[k] > credit[b[0]] ? [k] : b), [mix[0][0]]);
    credit[best] -= total;
    seq.push(best);
  }
  return seq;
}

/**
 * @param {object} ctx  runner context (webOrigin, apiOrigin, users, session, webhookSecret)
 * @param {{ mix?: Array<[string, number]>, runTag?: string, target?: "web" | "api" }} [options]
 * @returns {(i: number) => { kind: string, origin: string, spec: object }}
 */
export function mixedTraffic(ctx, options = {}) {
  const direct = options.target === "api";
  const seq = interleave((options.mix ?? MIX).filter(([k]) => !(direct && k === "page")));
  const users = ctx.users.length - 1; // index 0 is the hot (history-heavy) user
  const tag = options.runTag ?? Math.random().toString(36).slice(2, 8);
  let orderSeq = 0;
  return (i) => {
    const kind = seq[i % seq.length];
    const user = 1 + (Math.floor(i / seq.length) * 7 + i) % users;
    const ip = 100_000 + i; // a distinct client per arrival
    if (direct && kind !== "webhook") return { kind, origin: ctx.apiOrigin, spec: apiSpec(ctx, kind, user, ip) };
    switch (kind) {
      case "page": {
        const path = PAGES[i % PAGES.length];
        const spec = browserRequest(null, ip, "GET", path);
        spec.headers.accept = "text/html";
        return { kind, origin: ctx.webOrigin, spec };
      }
      case "balance":
        return { kind, origin: ctx.webOrigin, spec: browserRequest(ctx.session(user), ip, "GET", "/api/billing/balance") };
      case "history":
        return { kind, origin: ctx.webOrigin, spec: browserRequest(ctx.session(user), ip, "GET", "/api/billing/history") };
      case "chat":
        return {
          kind,
          origin: ctx.webOrigin,
          spec: browserRequest(ctx.session(user), ip, "POST", "/api/chat", { messages: [{ role: "user", content: "Why is benzene aromatic?" }] }),
        };
      case "login":
        return {
          kind,
          origin: ctx.webOrigin,
          spec: browserRequest(null, ip, "POST", "/api/auth/login", { email: ctx.users[user].email, password: PERF_PASSWORD }),
        };
      case "checkout":
        return { kind, origin: ctx.webOrigin, spec: browserRequest(ctx.session(user), ip, "POST", "/api/billing/checkout", { packageId: "starter" }) };
      case "webhook": {
        orderSeq += 1;
        const orderId = `${tag}${orderSeq}`;
        const raw = JSON.stringify(orderCreated(orderId, ctx.users[user]));
        return {
          kind,
          origin: ctx.apiOrigin,
          spec: {
            method: "POST",
            path: "/api/billing/webhooks/lemonsqueezy",
            headers: { "content-type": "application/json", "x-signature": createHmac("sha256", ctx.webhookSecret).update(raw).digest("hex"), "x-forwarded-for": clientIp(ip) },
            body: raw,
          },
        };
      }
      default:
        throw new Error(`unknown kind ${kind}`);
    }
  };
}

/** The request the BFF sends Express for one arrival of `kind` (target "api"). */
function apiSpec(ctx, kind, user, ip) {
  const token = ctx.session(user);
  // Like gateway/headers.ts: the internal key on every call, so Express honours X-Client-IP for its limiters.
  const bff = { "x-internal-service-key": ctx.internalKey, "x-client-ip": clientIp(ip) };
  const get = (path) => {
    const spec = apiRequest(token, "GET", path);
    return { ...spec, headers: { ...spec.headers, ...bff } };
  };
  const post = (path, json, auth = true) => ({
    method: "POST",
    path,
    headers: { "content-type": "application/json", accept: "application/json", ...bff, ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(json),
  });
  switch (kind) {
    case "balance":
      return get("/api/billing/balance");
    case "history":
      return get("/api/billing/history");
    case "chat": {
      const referenceId = randomUUID();
      return { ...post("/api/billing/consume", { operationType: "AI_CHAT_QUERY", referenceId }), then: () => post("/api/billing/capture", { referenceId }) };
    }
    case "login":
      return post("/api/auth/login", { email: ctx.users[user].email, password: PERF_PASSWORD }, false);
    case "checkout":
      return post("/api/billing/checkout", { packageId: "starter" });
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

/** A paid Lemon `order_created` for the starter pack (500 cents, 50 credits) attributed to `user`. */
function orderCreated(orderId, user) {
  return {
    meta: { event_name: "order_created", custom_data: { user_id: user.id, package_id: "starter" } },
    data: {
      type: "orders",
      id: orderId,
      attributes: {
        store_id: STORE_ID,
        customer_id: 1,
        identifier: `perf-${orderId}`,
        order_number: Number.parseInt(orderId.replace(/\D/g, "").slice(-9) || "1", 10),
        status: "paid",
        currency: "USD",
        total: 500,
        subtotal: 500,
        tax: 0,
        refunded: false,
        test_mode: false,
        user_email: user.email,
        first_order_item: { variant_id: Number(PERF_VARIANTS.starter), product_name: "Credits", price: 500 },
      },
    },
  };
}
