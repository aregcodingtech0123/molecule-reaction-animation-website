import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../services/auth-billing-service/src/app";
import { closePool } from "../../services/auth-billing-service/src/db/index";

export interface RunningService {
  origin: string;
  close(): Promise<void>;
}

/** Real Express service on an ephemeral loopback port; points the BFF env at it. */
export async function startAuthBillingService(): Promise<RunningService> {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AUTH_SERVICE_URL = `${origin}/api/auth`;
  process.env.BILLING_SERVICE_URL = `${origin}/api/billing`;
  process.env.USERS_SERVICE_URL = `${origin}/api/users`;
  return {
    origin,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await closePool();
    },
  };
}

/** A throwaway upstream whose behaviour each test scripts (errors, hangs, echo). */
export async function startFakeUpstream(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
): Promise<RunningService & { server: http.Server }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, body, res));
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    origin,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A port with nothing listening (connection refused). */
export async function deadOrigin(): Promise<string> {
  const s = http.createServer().listen(0, "127.0.0.1");
  await new Promise<void>((r) => s.once("listening", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return `http://127.0.0.1:${port}`;
}
