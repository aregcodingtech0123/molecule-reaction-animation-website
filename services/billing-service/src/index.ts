import "dotenv/config";
import { assertEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { disconnectDb, ensureSystemAccount, verifyDatabaseConnection } from "./db/prisma.js";
import { env } from "./config/env.js";

assertEnv();

const app = createApp();

async function bootstrap() {
  await verifyDatabaseConnection();
  await ensureSystemAccount();

  const server = app.listen(env.port, () => {
    console.log(`[billing-service] listening on http://localhost:${env.port}`);
    console.log(`[billing-service] routes: /billing/webhook, /billing/deduct, /billing/balance/:userId`);
  });

  async function shutdown(signal: string) {
    console.log(`[billing-service] ${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error("[billing-service] failed to start", err);
  process.exit(1);
});
