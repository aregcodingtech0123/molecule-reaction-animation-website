import { PrismaClient } from "@prisma/client";
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare function verifyDatabaseConnection(): Promise<void>;
export declare function disconnectDb(): Promise<void>;
/** Ensures the platform suspense account exists for double-entry legs. */
export declare function ensureSystemAccount(): Promise<void>;
//# sourceMappingURL=prisma.d.ts.map