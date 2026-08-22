import { PrismaClient } from "@prisma/client";
import { resolveDatabaseEnv } from "../config/database.js";

resolveDatabaseEnv();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function verifyDatabaseConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT NOW() AS server_time`;
    console.log("Database connection successfully established via environment tokens.");
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    console.error(`Database connection failed: ${details}`);
    process.exit(1);
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
