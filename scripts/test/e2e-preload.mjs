/**
 * Preloaded into BOTH E2E servers (Next.js and Express) via
 * NODE_OPTIONS=--import. Stubs Lemon Squeezy and Gemini at the network
 * boundary and blocks every other external host, so a real key that slipped
 * into the environment can never be used.
 */
import { installNetworkGuard, jsonResponse, stubExternal } from "./network-guard.mjs";

installNetworkGuard({ allowHosts: ["fonts.googleapis.com", "fonts.gstatic.com"] });

export const E2E_CHECKOUT_HOST = "checkout.e2e.test";
export const E2E_GEMINI_REPLY = "E2E stub: benzene is C6H6, an aromatic ring.";

// Lemon: POST /v1/checkouts → a checkout URL that echoes the attribution data so
// the test can build a matching signed webhook without reading server memory.
stubExternal("api.lemonsqueezy.com", async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const custom = body?.data?.attributes?.checkout_data?.custom ?? {};
  const variant = body?.data?.relationships?.variant?.data?.id ?? "";
  const redirectUrl = body?.data?.attributes?.product_options?.redirect_url ?? "";
  const qs = new URLSearchParams({ ...custom, variant_id: variant, redirect_url: redirectUrl });
  return jsonResponse(
    { data: { type: "checkouts", id: "e2e", attributes: { url: `https://${E2E_CHECKOUT_HOST}/buy?${qs}` } } },
    201,
  );
});

// Gemini (@google/genai REST): models/{model}:generateContent
stubExternal("generativelanguage.googleapis.com", () =>
  jsonResponse({
    candidates: [{ content: { role: "model", parts: [{ text: E2E_GEMINI_REPLY }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  }),
);
