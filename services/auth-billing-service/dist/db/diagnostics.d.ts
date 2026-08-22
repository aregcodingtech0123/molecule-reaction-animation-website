import type { DatabaseEnvConfig } from "../config/database.js";
export interface ParsedDbError {
    message: string;
    code?: string;
    errno?: number;
    syscall?: string;
    address?: string;
    port?: number;
    severity?: string;
    detail?: string;
    hint?: string;
    hintText?: string;
}
export declare function parseDbError(err: unknown): ParsedDbError;
/** Prints the full internal error object plus parsed PG / network fields. */
export declare function logFullDbError(context: string, err: unknown): ParsedDbError;
export declare function maskConnectionString(url: string): string;
export declare function maskConfig(config: DatabaseEnvConfig): Record<string, string | number | boolean>;
/** Logs raw env presence and resolved (masked) connection target before connecting. */
export declare function logEnvPresence(): void;
export declare function logResolvedConfig(config: DatabaseEnvConfig): void;
