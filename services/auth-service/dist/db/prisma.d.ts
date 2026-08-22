import { PrismaClient } from "@prisma/client";
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare function verifyDatabaseConnection(): Promise<void>;
export declare function disconnectDb(): Promise<void>;
//# sourceMappingURL=prisma.d.ts.map