/**
 * Operational visibility of a settlement nobody could resolve (Phase 2C step 5.2): every capture attempt and every probe
 * attempt ended without an authoritative outcome, so the BFF withholds the answer and cannot say whether the user paid.
 * That is SETTLEMENT_PROBE_UNRESOLVED: it names the reservation and makes no claim about the charge.
 *
 * The charge is answered by the database, through the read-only investigation in docs/ops/SETTLEMENT_INVESTIGATION.md.
 * Its SQL is taken from that document and run here, against states the real BFF and service produced.
 *
 * Real BFF → loopback stand-in → real Express service and test DB. Only @google/genai is mocked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenFor } from "../../services/auth-billing-service/tests/support/auth";
import { createTestPool, createUser } from "../../services/auth-billing-service/tests/support/db";
import { interceptClientQueries, sqlStateFault } from "../../services/auth-billing-service/tests/support/pg-fault";
import { sessionCookie } from "../support/bff";
import { startAuthBillingService, startFakeUpstream, type RunningService } from "../support/express-server";

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: gemini.generateContent } };
  }),
}));

import { POST } from "@/app/api/chat/route";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROMPT = "What is water?";
const ANSWER = "Water is H₂O.";
const START_BALANCE = 2;
/** tests/setup/bff-env.ts sets three delays, so four attempts per operation. */
const ATTEMPTS = 4;
const EVENT = "SETTLEMENT_PROBE_UNRESOLVED";

type Reply =
  | { kind: "forward" }
  | { kind: "json"; status: number; body: unknown }
  | { kind: "raw"; status: number; text: string }
  | { kind: "drop" }
  /** The service handles the call, then the connection drops: the BFF never learns the result. */
  | { kind: "commit-then-drop" }
  | { kind: "cut-body"; status: number };
type Rule = (n: number) => Reply;

const FORWARD: Reply = { kind: "forward" };
const DROP: Reply = { kind: "drop" };
const json = (status: number, body: unknown): Reply => ({ kind: "json", status, body });

const UNKNOWN_COMMIT = { success: false, error: "The capture outcome could not be confirmed.", code: "CAPTURE_INDETERMINATE", commitOutcome: "unknown" };
const TRANSIENT = { success: false, error: "The database is temporarily busy.", code: "TRANSIENT_DATABASE_ERROR" };
const UNAVAILABLE = { success: false, error: "Database is temporarily unavailable.", code: "DATABASE_UNAVAILABLE" };
const refundBody = (outcome: unknown) => ({ success: true, data: { refunded: false, amount: 1, balance: 1, ledgerId: null, outcome } });

let service: RunningService;
let db: pg.Pool;
let cleanups: Array<() => void | Promise<void>> = [];
beforeAll(async () => {
  service = await startAuthBillingService();
  db = createTestPool();
});
afterAll(async () => {
  await db.end();
  await service.close();
});
beforeEach(() => {
  for (const level of ["log", "info", "debug", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
  process.env.AUTH_SERVICE_URL = `${service.origin}/api/auth`;
  process.env.BILLING_SERVICE_URL = `${service.origin}/api/billing`;
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
  gemini.generateContent.mockReset();
  gemini.generateContent.mockResolvedValue({ text: ANSWER });
});
afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function forwardToService(req: http.IncomingMessage, body: string) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
  }
  const upstream = await fetch(`${service.origin}/api/billing${req.url ?? ""}`, { method: req.method, headers, body });
  return { status: upstream.status, text: await upstream.text() };
}

/** Points the BFF at a stand-in. Whatever has no rule goes to the real service. */
async function billing(rules: { capture?: Rule; refund?: Rule }) {
  const seen: Array<{ op: string; reference: string; answered?: string }> = [];
  const counts = new Map<string, number>();
  const proxy = await startFakeUpstream(async (req, body, res) => {
    const op = (req.url ?? "").replace(/^\//, "");
    const n = (counts.get(op) ?? 0) + 1;
    counts.set(op, n);
    const call: { op: string; reference: string; answered?: string } = { op, reference: (JSON.parse(body) as { referenceId: string }).referenceId };
    seen.push(call);
    const reply = rules[op as "capture" | "refund"]?.(n) ?? FORWARD;
    switch (reply.kind) {
      case "json":
        res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
        return;
      case "raw":
        res.writeHead(reply.status, { "content-type": "text/plain" }).end(reply.text);
        return;
      case "drop":
        res.socket?.destroy();
        return;
      case "cut-body":
        res.writeHead(reply.status, { "content-type": "application/json", "content-length": "1000" });
        res.write(`{"success":true,`, () => res.socket?.destroy());
        return;
      case "commit-then-drop":
        await forwardToService(req, body);
        res.socket?.destroy();
        return;
      case "forward": {
        const upstream = await forwardToService(req, body);
        call.answered = upstream.text;
        res.writeHead(upstream.status, { "content-type": "application/json" }).end(upstream.text);
      }
    }
  });
  process.env.BILLING_SERVICE_URL = proxy.origin;
  cleanups.push(() => proxy.close());
  return {
    of: (op: string) => seen.filter((c) => c.op === op),
    /** Tokens the real service minted for this turn. */
    tokens() {
      const data = (JSON.parse(seen.find((c) => c.op === "consume")!.answered!) as { data: Record<string, string> }).data;
      return [data.captureCapabilityToken!, data.refundCapabilityToken!];
    },
    reference: () => seen.find((c) => c.op === "consume")!.reference,
  };
}

async function funded() {
  const u = await createUser(db, { balance: 0, verified: true });
  await db.query(`SELECT post_credit_transaction($1, $2, 'SIGNUP_BONUS', 'signup')`, [u.id, START_BALANCE]);
  return u;
}

function chat(u: { id: string; email: string }) {
  return POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie(tokenFor(u)) },
      body: JSON.stringify({ messages: [{ role: "user", content: PROMPT }] }),
    }),
  );
}

const LEVELS = ["log", "info", "debug", "warn", "error"] as const;
const allLogOutput = () =>
  LEVELS.flatMap((level) => vi.mocked(console[level]).mock.calls)
    .map((args) => args.map((a) => inspect(a, { depth: null, showHidden: true })).join(" "))
    .join("\n");
const eventCalls = () => LEVELS.flatMap((level) => vi.mocked(console[level]).mock.calls).filter(([line]) => String(line).includes(EVENT));
const billingLines = (name: string) => vi.mocked(console.error).mock.calls.filter(([line]) => String(line).includes(`[billing] ${name}`));
const theEvent = () => {
  const calls = eventCalls();
  expect(calls).toHaveLength(1);
  return calls[0]![1] as Record<string, unknown>;
};

async function expectWithheld(res: Response) {
  const text = await res.text();
  expect(res.status).toBe(503);
  expect(JSON.parse(text)).toEqual({ error: "BILLING_UNAVAILABLE" });
}

describe("every capture attempt and every probe attempt failed", () => {
  it("emits one event naming the reservation, with exactly the safe fields, and claims nothing about the charge", async () => {
    const proxy = await billing({ capture: () => DROP, refund: () => DROP });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(proxy.of("capture")).toHaveLength(ATTEMPTS);
    expect(proxy.of("refund")).toHaveLength(ATTEMPTS);
    const event = theEvent();
    expect(event).toEqual({
      event: EVENT,
      referenceId: proxy.reference(),
      probeOutcome: "unresolved",
      captureClassification: "response_lost",
      captureHttpStatus: null,
      captureAttempts: ATTEMPTS,
      probeHttpStatus: null,
      probeAttempts: ATTEMPTS,
      failureCategory: "probe_response_lost",
      answerDelivery: "withheld",
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(vi.mocked(console.error).mock.calls.find(([line]) => String(line).includes(EVENT))).toBeDefined();
  });

  it("does not also report a capture failure or a release failure: those would be claims it cannot make", async () => {
    await billing({ capture: () => DROP, refund: () => DROP });

    await expectWithheld(await chat(await funded()));

    expect(billingLines("CAPTURE_FAILED")).toEqual([]);
    expect(billingLines("RELEASE_FAILED")).toEqual([]);
    expect(billingLines("CAPTURE_CONFIRMED_BY_PROBE")).toEqual([]);
  });

  it.each<[string, Reply, string, number | null]>([
    ["a dropped connection", DROP, "response_lost", null],
    ["a truncated body", { kind: "cut-body", status: 200 }, "response_lost", null],
    ["a gateway 502", { kind: "raw", status: 502, text: "Bad Gateway" }, "gateway_no_service_code", 502],
    ["a code-less 503", json(503, {}), "gateway_no_service_code", 503],
    ["503 CAPTURE_INDETERMINATE + unknown", json(503, UNKNOWN_COMMIT), "capture_indeterminate_unknown", 503],
    ["503 TRANSIENT_DATABASE_ERROR", json(503, TRANSIENT), "transient_database_error", 503],
    ["503 DATABASE_UNAVAILABLE", json(503, UNAVAILABLE), "database_unavailable", 503],
  ])("the last capture was %s: its fixed classification is reported", async (_name, reply, captureClassification, captureHttpStatus) => {
    await billing({ capture: () => reply, refund: () => DROP });

    await expectWithheld(await chat(await funded()));

    expect(theEvent()).toMatchObject({ captureClassification, captureHttpStatus, captureAttempts: ATTEMPTS });
  });

  it.each<[string, Reply, string, number | null, number]>([
    ["a dropped connection", DROP, "probe_response_lost", null, ATTEMPTS],
    ["a truncated body", { kind: "cut-body", status: 200 }, "probe_response_lost", null, ATTEMPTS],
    ["a gateway 502", { kind: "raw", status: 502, text: "Bad Gateway" }, "probe_service_unavailable", 502, ATTEMPTS],
    ["a retryable database error", json(503, TRANSIENT), "probe_service_unavailable", 503, ATTEMPTS],
    ["a 429", json(429, {}), "probe_service_unavailable", 429, ATTEMPTS],
    ["a refused capability", json(403, { success: false, code: "SETTLEMENT_NOT_AUTHORIZED" }), "probe_rejected", 403, 1],
    ["a 200 with an unknown outcome", json(200, refundBody("mystery")), "probe_malformed_response", 200, 1],
    ["a 200 with no outcome, whatever else it says", json(200, { success: true, data: { reason: "not_refundable", alreadyProcessed: true } }), "probe_malformed_response", 200, 1],
    ["a 200 that is not JSON", { kind: "raw", status: 200, text: "OK" }, "probe_malformed_response", 200, 1],
  ])("the probe ended in %s: its fixed category is reported", async (_name, reply, failureCategory, probeHttpStatus, probeAttempts) => {
    await billing({ capture: () => json(503, TRANSIENT), refund: () => reply });

    await expectWithheld(await chat(await funded()));

    expect(theEvent()).toMatchObject({ failureCategory, probeHttpStatus, probeAttempts, probeOutcome: "unresolved" });
  });

  it("a logger that throws changes nothing: same answer, same calls, same state", async () => {
    const proxy = await billing({ capture: () => DROP, refund: () => DROP });
    vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes(EVENT)) throw new Error("log sink down");
    });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(proxy.of("capture")).toHaveLength(ATTEMPTS);
    expect(proxy.of("refund")).toHaveLength(ATTEMPTS);
    const { rows } = await db.query(`SELECT status FROM ai_credit_holds WHERE user_id = $1`, [u.id]);
    expect(rows).toEqual([{ status: "held" }]);
  });
});

describe("an outcome the system knows is not unresolved", () => {
  it("a confirmed capture emits nothing", async () => {
    await billing({});
    expect((await chat(await funded())).status).toBe(200);
    expect(eventCalls()).toEqual([]);
  });

  it("a capture confirmed after retries emits nothing", async () => {
    await billing({ capture: (n) => (n === 1 ? DROP : FORWARD) });
    expect((await chat(await funded())).status).toBe(200);
    expect(eventCalls()).toEqual([]);
  });

  it("already_captured from the probe emits nothing, and the answer is delivered", async () => {
    await billing({ capture: () => json(503, TRANSIENT), refund: () => json(200, refundBody("already_captured")) });
    expect((await chat(await funded())).status).toBe(200);
    expect(eventCalls()).toEqual([]);
    expect(billingLines("CAPTURE_FAILED")).toEqual([]);
  });

  it.each(["released", "already_released", "already_expired", "capture_failed", "not_found"])("probe outcome %s emits nothing, and is reported as that outcome", async (outcome) => {
    await billing({ capture: () => json(503, TRANSIENT), refund: () => json(200, refundBody(outcome)) });

    await expectWithheld(await chat(await funded()));

    expect(eventCalls()).toEqual([]);
    expect(billingLines("CAPTURE_FAILED")).toEqual([[expect.any(String), expect.objectContaining({ probeOutcome: outcome })]]);
    expect(billingLines("RELEASE_FAILED")).toEqual([]);
  });

  it.each<[string, Reply]>([
    ["409 rolled_back", json(409, { success: false, code: "CAPTURE_INDETERMINATE", commitOutcome: "rolled_back" })],
    ["403 refused", json(403, { success: false, code: "SETTLEMENT_NOT_AUTHORIZED" })],
    ["a malformed 200", json(200, { success: true, data: {} })],
  ])("a capture ended without a probe (%s) emits nothing", async (_name, reply) => {
    const proxy = await billing({ capture: () => reply });

    await expectWithheld(await chat(await funded()));

    expect(proxy.of("refund")).toEqual([]);
    expect(eventCalls()).toEqual([]);
  });

  it("a failed release after a model failure is a release failure: no probe happened", async () => {
    gemini.generateContent.mockRejectedValue(new Error("boom"));
    await billing({ refund: () => DROP });

    expect((await chat(await funded())).status).toBe(502);

    expect(eventCalls()).toEqual([]);
    expect(billingLines("RELEASE_FAILED")).toHaveLength(1);
  });
});

describe("log hygiene", () => {
  const POISON = {
    db: "ERROR: duplicate key value violates unique constraint at SELECT post_credit_transaction",
    provider: "PROVIDER-RESPONSE-BODY-MARKER",
    email: "victim-marker@example.test",
    long: `UNBOUNDED-${"x".repeat(5000)}`,
  };
  const poisonedBody = { error: POISON.db, message: POISON.provider, email: POISON.email, detail: POISON.long, data: { outcome: POISON.long, reason: POISON.provider } };

  function expectClean(logs: string, secrets: string[]) {
    for (const secret of [...secrets, ...Object.values(POISON)]) expect(logs).not.toContain(secret);
    for (const token of secrets.filter((s) => s.startsWith("msc1."))) {
      const [, payload, mac] = token.split(".") as [string, string, string];
      expect(logs).not.toContain(payload);
      expect(logs).not.toContain(mac);
    }
    expect(logs).not.toMatch(/authorization/i);
    expect(logs).not.toContain("Bearer ");
    expect(logs).not.toContain(PROMPT);
    expect(logs).not.toContain(ANSWER);
    expect(logs).not.toContain(ANSWER.normalize("NFD"));
  }

  it.each<[string, Reply, Reply]>([
    ["both exhausted, with hostile bodies", json(503, poisonedBody), json(503, poisonedBody)],
    ["hostile gateway HTML", { kind: "raw", status: 502, text: POISON.provider }, { kind: "raw", status: 502, text: POISON.provider }],
    ["a hostile 200 probe", json(503, poisonedBody), json(200, { success: true, ...poisonedBody })],
    ["a refused probe with a hostile body", json(503, poisonedBody), json(403, { code: POISON.long, ...poisonedBody })],
    ["connections lost", DROP, DROP],
  ])("%s: tokens, keys, JWT, body text, prompt, answer and e-mail stay out of every log line", async (_name, capture, refund) => {
    const proxy = await billing({ capture: () => capture, refund: () => refund });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(eventCalls()).toHaveLength(1);
    expectClean(allLogOutput(), [...proxy.tokens(), process.env.INTERNAL_SERVICE_SECRET!, tokenFor(u), u.email]);
  });

  it("every value in the event is a bounded fixed string, a status, a count or a timestamp, whatever the bodies said", async () => {
    const proxy = await billing({ capture: () => json(503, poisonedBody), refund: () => json(200, { success: true, ...poisonedBody }) });

    await expectWithheld(await chat(await funded()));

    const event = theEvent();
    const { referenceId, occurredAt, captureHttpStatus, captureAttempts, probeHttpStatus, probeAttempts, ...fixed } = event;
    expect(referenceId).toBe(proxy.reference());
    expect(new Date(occurredAt as string).getTime()).not.toBeNaN();
    for (const n of [captureHttpStatus, captureAttempts, probeHttpStatus, probeAttempts]) expect(Number.isInteger(n)).toBe(true);
    for (const value of Object.values(fixed)) expect(value).toMatch(/^[A-Za-z_]{1,40}$/);
    expect(JSON.stringify(event).length).toBeLessThan(500);
  });

  describe("the other settlement lines take no free text from a response either", () => {
    it.each<[string, Reply]>([
      ["a long code", json(409, { success: false, code: POISON.long })],
      ["a code that is prose", json(409, { success: false, code: POISON.db })],
      ["a code carrying an address", json(403, { success: false, code: POISON.email })],
      ["a hostile commitOutcome", json(409, { success: false, code: "CAPTURE_INDETERMINATE", commitOutcome: POISON.provider })],
    ])("CAPTURE_FAILED with %s", async (_name, capture) => {
      const proxy = await billing({ capture: () => capture });
      const u = await funded();

      await expectWithheld(await chat(u));

      expect(billingLines("CAPTURE_FAILED")).toHaveLength(1);
      expectClean(allLogOutput(), [...proxy.tokens(), u.email]);
    });

    it("a service code keeps its name, because operators search for it", async () => {
      await billing({ capture: () => json(409, { success: false, code: "HOLD_EXPIRED" }) });

      await expectWithheld(await chat(await funded()));

      expect(billingLines("CAPTURE_FAILED")[0]![1]).toMatchObject({ code: "HOLD_EXPIRED", status: 409 });
    });
  });
});

describe("the read-only investigation, against real outcomes", () => {
  const runbookPath = path.join(repoRoot, "docs/ops/SETTLEMENT_INVESTIGATION.md");
  // A missing document fails the tests that need it, not the whole file.
  const runbook = fs.existsSync(runbookPath) ? fs.readFileSync(runbookPath, "utf8") : "";
  const sqlBlocks = [...runbook.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);

  type Found = { hold: Record<string, unknown> | undefined; ledger: Array<Record<string, unknown>> };

  /** The document's own SQL, in a READ ONLY transaction as it says, so a write would be an error. */
  async function investigate(reference: string): Promise<Found> {
    expect(sqlBlocks).toHaveLength(1);
    const sql = sqlBlocks[0]!.replaceAll("<reference id>", reference);
    const results = (await db.query(sql)) as unknown as Array<{ command: string; rows: Array<Record<string, unknown>> }>;
    const selects = results.filter((r) => r.command === "SELECT");
    expect(selects).toHaveLength(2);
    return { hold: selects[0]!.rows[0], ledger: selects[1]!.rows };
  }

  const issuesOf = async (userId: string) => (await db.query(`SELECT issue, reference_id FROM ledger_reconciliation() WHERE user_id = $1`, [userId])).rows;
  async function financialState(userId: string) {
    const holds = await db.query(`SELECT * FROM ai_credit_holds WHERE user_id = $1 ORDER BY reference_id`, [userId]);
    const ledger = await db.query(`SELECT * FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`, [userId]);
    const balance = await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [userId]);
    return JSON.stringify([holds.rows, ledger.rows, balance.rows]);
  }
  function runReconcileCli() {
    const res = spawnSync(process.execPath, [path.join(repoRoot, "services/auth-billing-service/scripts/reconcile.mjs")], {
      cwd: path.join(repoRoot, "services/auth-billing-service"),
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", MOLECULESTUDIO_SKIP_DOTENV: "1", NODE_ENV: "development", DATABASE_URL: process.env.DATABASE_URL! },
    });
    return res.status;
  }
  const debitsIn = (found: Found) => found.ledger.filter((r) => r.transaction_type === "CREDIT_CONSUMPTION");

  it("the document's SQL only reads", () => {
    expect(sqlBlocks.join("\n")).toMatch(/^BEGIN READ ONLY;/);
    expect(sqlBlocks.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|post_credit_transaction|release_expired_ai_holds)\b/i);
  });

  it("the capture committed and the event was emitted: the row says captured with one debit, and reconciliation correctly stays silent", async () => {
    const proxy = await billing({ capture: () => ({ kind: "commit-then-drop" }), refund: () => DROP });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(theEvent()).toMatchObject({ referenceId: proxy.reference(), answerDelivery: "withheld" });
    const found = await investigate(proxy.reference());
    expect(found.hold).toMatchObject({ status: "captured", settle_reason: null });
    expect(debitsIn(found)).toEqual([expect.objectContaining({ amount: -1, reference_id: proxy.reference() })]);
    expect(found.hold!.ledger_row_id).toBe(debitsIn(found)[0]!.id);
    expect(await issuesOf(u.id)).toEqual([]);
  });

  it("nothing committed and the event was emitted: the row stays held with no debit, and reconciliation lists it once it expires", async () => {
    const proxy = await billing({ capture: () => DROP, refund: () => DROP });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(theEvent()).toMatchObject({ referenceId: proxy.reference() });
    const held = await investigate(proxy.reference());
    expect(held.hold).toMatchObject({ status: "held", ledger_row_id: null });
    expect(debitsIn(held)).toEqual([]);
    expect(await issuesOf(u.id)).toEqual([]);

    await db.query(`UPDATE ai_credit_holds SET expires_at = NOW() - interval '1 second' WHERE user_id = $1`, [u.id]);
    await db.query(`SELECT release_expired_ai_holds()`);

    const expired = await investigate(proxy.reference());
    expect(expired.hold).toMatchObject({ status: "expired", settle_reason: "expired_unsettled", ledger_row_id: null });
    expect(debitsIn(expired)).toEqual([]);
    expect(await issuesOf(u.id)).toEqual([{ issue: "hold_expired_unsettled", reference_id: proxy.reference() }]);
  });

  it("the probe released but its answer was lost: the event was emitted, the row says released by the probe, no debit", async () => {
    const proxy = await billing({ capture: () => DROP, refund: () => ({ kind: "commit-then-drop" }) });
    const u = await funded();

    await expectWithheld(await chat(u));

    expect(eventCalls()).toHaveLength(1);
    const found = await investigate(proxy.reference());
    expect(found.hold).toMatchObject({ status: "released", settle_reason: "capture_unconfirmed", ledger_row_id: null });
    expect(debitsIn(found)).toEqual([]);
    expect(await issuesOf(u.id)).toEqual([]);
  });

  it("a confirmed, durable capture failure is a different report: capture_failed in reconciliation, no event", async () => {
    const proxy = await billing({});
    const u = await funded();
    gemini.generateContent.mockImplementation(async () => {
      const state = { fired: false };
      cleanups.push(
        interceptClientQueries((q) => {
          if (state.fired || !/post_credit_transaction/.test(q.sql)) return null;
          state.fired = true;
          return q.proceed(sqlStateFault("23505"));
        }),
      );
      return { text: ANSWER };
    });

    await expectWithheld(await chat(u));

    expect(eventCalls()).toEqual([]);
    const found = await investigate(proxy.reference());
    expect(found.hold).toMatchObject({ status: "capture_failed", ledger_row_id: null });
    expect(debitsIn(found)).toEqual([]);
    expect(await issuesOf(u.id)).toEqual([{ issue: "capture_failed", reference_id: proxy.reference() }]);
  });

  it("a normal captured turn and a released turn are not reported as problems, and a released turn has no debit", async () => {
    const delivered = await billing({});
    const u = await funded();
    expect((await chat(u)).status).toBe(200);
    expect((await investigate(delivered.reference())).hold).toMatchObject({ status: "captured" });

    const failed = await billing({});
    gemini.generateContent.mockRejectedValue(new Error("boom"));
    expect((await chat(u)).status).toBe(502);
    const released = await investigate(failed.reference());
    expect(released.hold).toMatchObject({ status: "released", settle_reason: "ai_generation_error" });
    expect(debitsIn(released)).toEqual([]);

    expect(await issuesOf(u.id)).toEqual([]);
  });

  it("a reference nobody reserved finds nothing, rather than an error", async () => {
    expect(await investigate("00000000-0000-4000-8000-00000000dead")).toEqual({ hold: undefined, ledger: [] });
  });

  it("investigating and reconciling, repeatedly, changes no hold, ledger row or balance", async () => {
    const proxy = await billing({ capture: () => ({ kind: "commit-then-drop" }), refund: () => DROP });
    const u = await funded();
    await chat(u);
    const before = await financialState(u.id);

    for (let i = 0; i < 3; i++) {
      await investigate(proxy.reference());
      await issuesOf(u.id);
      expect([0, 2]).toContain(runReconcileCli());
    }

    expect(await financialState(u.id)).toBe(before);
  });

  it("the database does not stop a second goodwill adjustment, so the runbook warns about it and its lookup shows an earlier one", async () => {
    expect(runbook).toContain("Nothing in the database prevents a second posting");
    const u = await funded();
    const reference = crypto.randomUUID();
    const goodwill = `settlement-goodwill-${reference}`;
    expect(runbook).toContain(goodwill.replace(reference, "<reference id>"));
    const post = () => db.query(`SELECT post_credit_transaction($1, 1, 'ADMIN_ADJUSTMENT', $2)`, [u.id, goodwill]);

    await post();

    expect((await investigate(reference)).ledger).toEqual([expect.objectContaining({ transaction_type: "ADMIN_ADJUSTMENT", reference_id: goodwill })]);
    // If a later migration adds the protection, this fails and the warning can go.
    await post();
    const { rows } = await db.query(`SELECT balance FROM user_balances WHERE user_id = $1`, [u.id]);
    expect(rows).toEqual([{ balance: START_BALANCE + 2 }]);
  });
});
