import "dotenv/config";
/** Resolved PostgreSQL connection settings (from DATABASE_URL or discrete DB_* vars). */
export interface DatabaseEnvConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionString: string;
}
export declare function resolveDatabaseEnv(): DatabaseEnvConfig;
export declare function assertDatabaseEnv(): DatabaseEnvConfig;
//# sourceMappingURL=database.d.ts.map