/**
 * SEC-02 follow-up (behavioural): what the PUBLIC Express service does with compressed request
 * bodies, on both body parsers — the global JSON parser (32 kb) and the webhook raw parser
 * (256 kb, read before HMAC verification). Every case must end in a definite 4xx/2xx answer: no
 * uncaught exception (crash), no hang, no memory blow-up; size limits are measured AFTER
 * decompression, so a tiny compressed body that inflates past the limit is refused before the
 * webhook signature is ever computed.
 *
 * SEC-09: a compressed body that does not decode (bad gzip / deflate / br / zstd stream) used to be
 * answered 500 (and logged with a stack) instead of 400.
 */
import { createHmac } from "node:crypto";
import zlib from "node:zlib";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/index.js";
import { spyConsole } from "../support/console";
import { spyOnPostgres } from "../support/pg-spy";
import { TEST_ENV } from "../setup/env";

const app = createApp();
afterAll(async () => {
  await closePool();
});

const uncaught: unknown[] = [];
const onUncaught = (err: unknown) => uncaught.push(err);
beforeEach(() => {
  spyConsole();
  uncaught.length = 0;
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUncaught);
});
afterEach(() => {
  process.off("uncaughtException", onUncaught);
  process.off("unhandledRejection", onUncaught);
});

const LOGIN = "/api/auth/login";
const WEBHOOK = "/api/billing/webhooks/lemonsqueezy";
const json = (bytes: number) => Buffer.from(JSON.stringify({ email: "a@example.test", password: "x", pad: "a".repeat(Math.max(0, bytes - 50)) }));
const sign = (raw: Buffer) => createHmac("sha256", TEST_ENV.LEMONSQUEEZY_WEBHOOK_SECRET).update(raw).digest("hex");

/** gzip of `mb` megabytes of zeros, built from 1 MB chunks (the test never holds the inflated data). */
async function gzipBombAsync(mb: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    const gz = zlib.createGzip({ level: 9 });
    gz.on("data", (c: Buffer) => parts.push(c));
    gz.on("end", () => resolve(Buffer.concat(parts)));
    gz.on("error", reject);
    const chunk = Buffer.alloc(1024 * 1024);
    let i = 0;
    const pump = () => {
      while (i < mb) {
        i += 1;
        if (!gz.write(chunk)) return gz.once("drain", pump);
      }
      gz.end();
    };
    pump();
  });
}

/**
 * Raw HTTP against an ephemeral listener: the body goes out byte-for-byte. (supertest/superagent
 * JSON-serialises a Buffer when Content-Type is application/json, which is not what a client sends.)
 */
let server: http.Server;
let base: { host: string; port: number };
beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address() as AddressInfo;
  base = { host: "127.0.0.1", port: a.port };
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function send(path: string, body: Buffer, encoding: string | null, extra: Record<string, string> = {}) {
  const started = Date.now();
  return new Promise<{ status: number; code: string | undefined; ms: number; body: unknown }>((resolve, reject) => {
    const headers: Record<string, string | number> = { "Content-Type": "application/json", "Content-Length": body.length, ...extra };
    if (encoding !== null) headers["Content-Encoding"] = encoding;
    const req = http.request({ ...base, method: "POST", path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        let parsed: { code?: string } | string = Buffer.concat(chunks).toString("utf8");
        try {
          parsed = JSON.parse(parsed);
        } catch {
          /* keep text */
        }
        setTimeout(() => resolve({ status: res.statusCode ?? 0, code: typeof parsed === "object" ? parsed.code : undefined, ms: Date.now() - started, body: parsed }), 50);
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error(`no response for ${path} within 15 s (hang)`)));
    req.end(body);
  });
}

const small = json(200);
const encodings: Array<[string, (b: Buffer) => Buffer]> = [
  ["gzip", (b) => zlib.gzipSync(b)],
  ["deflate", (b) => zlib.deflateSync(b)],
  ["br", (b) => zlib.brotliCompressSync(b)],
  // Node 24 zlib has zstd; the installed @types/node predates it.
  ["zstd", (b) => (zlib as unknown as { zstdCompressSync(b: Buffer): Buffer }).zstdCompressSync(b)],
  ["identity", (b) => b],
];

describe.each([
  ["global JSON parser (login)", LOGIN],
  ["webhook raw parser", WEBHOOK],
])("compressed request bodies — %s", (_label, path) => {
  it.each(encodings)("valid %s body is decoded and handled normally", async (enc, compress) => {
    const r = await send(path, compress(small), enc, path === WEBHOOK ? { "X-Signature": "0".repeat(64) } : {});
    // login: invalid credentials (401) or validation (400); webhook: bad signature (401)
    expect([400, 401]).toContain(r.status);
    expect(uncaught).toEqual([]);
  });

  it.each([["compress"], ["x-made-up"], ["gzip, gzip"]])("Content-Encoding %j → 415, nothing decoded", async (enc) => {
    const r = await send(path, zlib.gzipSync(small), enc);
    expect(r.status).toBe(415);
    expect(r.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(uncaught).toEqual([]);
  });

  it.each([
    ["garbage behind a gzip header", "gzip", Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.from("not really gzip at all")])],
    ["a truncated gzip stream", "gzip", zlib.gzipSync(json(5_000)).subarray(0, 40)],
    ["random bytes declared as deflate", "deflate", Buffer.from("definitely-not-deflate-data")],
    ["random bytes declared as br", "br", Buffer.from("definitely-not-brotli-data")],
    ["gzip bytes declared as zstd", "zstd", zlib.gzipSync(Buffer.from('{"a":1}'))],
  ])("%s → 400 INVALID_CONTENT_ENCODING, no crash (SEC-09)", async (_l, enc, body) => {
    const r = await send(path, body, enc);
    expect(r.status).toBe(400);
    expect(r.code).toBe("INVALID_CONTENT_ENCODING");
    expect(JSON.stringify(r.body)).not.toMatch(/incorrect header|zlib|Z_[A-Z_]+_ERROR|at \w+ \(/);
    expect(uncaught).toEqual([]);
  });

  it("a body under the limit compressed but over it decompressed → 413, refused before any handler", async () => {
    const limit = path === WEBHOOK ? 256 * 1024 : 32 * 1024;
    const raw = json(limit + 8 * 1024);
    const compressed = zlib.gzipSync(raw);
    expect(compressed.length).toBeLessThan(limit / 10);
    const pg = spyOnPostgres();
    const r = await send(path, compressed, "gzip", path === WEBHOOK ? { "X-Signature": sign(raw) } : {});
    expect(r.status).toBe(413);
    expect(r.code).toBe("PAYLOAD_TOO_LARGE");
    expect(pg.total()).toBe(0);
    expect(uncaught).toEqual([]);
  });
});

describe("decompression bomb against the public service", () => {
  it.each([
    ["global JSON parser (login)", LOGIN],
    ["webhook raw parser", WEBHOOK],
  ])("%s: ~200 MB of zeros in a ~200 kB gzip → 413 fast, without inflating it all", async (_l, path) => {
    const bomb = await gzipBombAsync(200);
    expect(bomb.length).toBeLessThan(400 * 1024);
    const before = process.memoryUsage();
    const r = await send(path, bomb, "gzip", path === WEBHOOK ? { "X-Signature": "0".repeat(64) } : {});
    const after = process.memoryUsage();
    const grewMb = (after.rss - before.rss) / (1024 * 1024);
    const kb = (bomb.length / 1024).toFixed(0);
    process.stdout.write(`[bomb] ${path}: ${r.status} in ${r.ms} ms, rss +${grewMb.toFixed(1)} MB, compressed ${kb} kB\n`);
    expect(r.status).toBe(413);
    expect(r.ms).toBeLessThan(3_000);
    expect(grewMb).toBeLessThan(64);
    expect(uncaught).toEqual([]);
  });
});
