import "dotenv/config";
import { assertEnv, env } from "./config/env.js";
import { createApp } from "./app.js";
import { disconnectDb, verifyDatabaseConnection } from "./db/prisma.js";
assertEnv();
const app = createApp();
async function bootstrap() {
    await verifyDatabaseConnection();
    const server = app.listen(env.port, () => {
        console.log(`[auth-service] listening on http://localhost:${env.port}`);
        console.log(`[auth-service] routes: /auth/register, /auth/login, /auth/me`);
    });
    async function shutdown(signal) {
        console.log(`[auth-service] ${signal} received — shutting down`);
        server.close(async () => {
            await disconnectDb();
            process.exit(0);
        });
    }
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
bootstrap().catch((err) => {
    console.error("[auth-service] failed to start", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map