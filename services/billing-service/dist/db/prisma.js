import { PrismaClient } from "@prisma/client";
import { resolveDatabaseEnv } from "../config/database.js";
resolveDatabaseEnv();
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.billingPrisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.billingPrisma = prisma;
}
export async function verifyDatabaseConnection() {
    try {
        await prisma.$queryRaw `SELECT NOW() AS server_time`;
        console.log("Database connection successfully established via environment tokens.");
    }
    catch (err) {
        const details = err instanceof Error ? err.message : String(err);
        console.error(`Database connection failed: ${details}`);
        process.exit(1);
    }
}
export async function disconnectDb() {
    await prisma.$disconnect();
}
/** Ensures the platform suspense account exists for double-entry legs. */
export async function ensureSystemAccount() {
    await prisma.systemAccount.upsert({
        where: { id: "00000000-0000-0000-0000-000000000001" },
        create: { id: "00000000-0000-0000-0000-000000000001", name: "platform_suspense" },
        update: {},
    });
}
//# sourceMappingURL=prisma.js.map