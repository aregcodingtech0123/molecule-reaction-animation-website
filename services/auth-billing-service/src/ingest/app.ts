/**
 * The ingestion process's HTTP surface: the Lemon webhook endpoint and a health probe. Nothing else is mounted (no auth, billing or
 * user routes), and nothing here can credit, settle or read the ledger.
 *
 *   1. raw body -> signature (HMAC over the exact bytes, constant-time) -> JSON, all before any database contact;
 *   2. classification into typed columns and `eligible` (classify.ts);
 *   3. one insert as the webhook role, bounded by WEBHOOK_STORE_TIMEOUT_MS; only then 200.
 * Not stored (database down, role or contract wrong, deadline passed): 503 + Retry-After, so Lemon redelivers.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { verifyLemonSignature, parseLemonSqueezyEvent } from "../lib/lemonEvent.js";
import { AppError } from "../types/index.js";
import { classifyDelivery } from "./classify.js";
import type { IngestConfig } from "./config.js";
import type { IngestStore } from "./store.js";

export const WEBHOOK_PATH = "/api/billing/webhooks/lemonsqueezy";

function withTimeout<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`not stored within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createIngestApp(deps: { config: IngestConfig; store: IngestStore }) {
  const { config, store } = deps;
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", async (_req, res) => {
    const readiness = await store.ready();
    res.status(readiness.ready ? 200 : 503).json({ success: readiness.ready, service: "webhook-ingest", status: readiness.ready ? "ok" : "degraded" });
  });

  app.post(WEBHOOK_PATH, express.raw({ type: "application/json", limit: "256kb" }), async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody?.length) {
      res.status(400).json({ error: "Webhook requires raw request body." });
      return;
    }
    const signature = typeof req.headers["x-signature"] === "string" ? req.headers["x-signature"] : undefined;

    let event;
    try {
      verifyLemonSignature(rawBody, signature, config.webhookSecret);
      event = parseLemonSqueezyEvent(rawBody);
    } catch (err) {
      const status = err instanceof AppError ? err.statusCode : 401;
      console.warn("[ingest] Rejected:", err instanceof AppError ? err.code : "unknown");
      res.status(status).json({ error: status === 400 ? "Invalid webhook body" : "Invalid signature" });
      return;
    }

    const row = classifyDelivery(rawBody, event, config);
    let stored;
    try {
      stored = await withTimeout(config.storeTimeoutMs, store.insert(row));
    } catch (err) {
      console.error("[ingest] NOT STORED — answered 503 so Lemon retries the delivery", {
        event: row.eventName,
        orderId: row.providerOrderId,
        errorName: err instanceof Error ? err.name : "unknown",
        sqlstate: err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : null,
      });
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Webhook temporarily unavailable" });
      return;
    }

    res.status(200).json({ received: true });
    console.log("[ingest] Stored", {
      event: row.eventName,
      orderId: row.providerOrderId,
      storedEventId: stored.id,
      eligible: row.eligible,
      ...(row.eligible ? {} : { ineligibleReason: row.ineligibleReason }),
      ...(stored.inserted ? {} : { duplicateOf: stored.status }),
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  // Body too large (413), bad encoding and the like: the status only, never the internals.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: unknown }).status) : 500;
    res.status(status >= 400 && status < 500 ? status : 500).json({ error: "Invalid request" });
  });
  return app;
}
