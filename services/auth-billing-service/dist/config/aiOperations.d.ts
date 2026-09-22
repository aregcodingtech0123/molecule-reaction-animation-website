/**
 * Credit price list for every metered AI operation.
 *
 * This is the single source of truth. The frontend never sends a price — it
 * sends an operation name and the server looks the cost up here, so a tampered
 * client cannot buy a HD render for the price of a chat message.
 */
export declare const AI_OPERATION_COSTS: {
    readonly ATOM_GENERATE: 2;
    readonly ARCH_RENDER_STD: 5;
    readonly ARCH_RENDER_HD: 10;
    readonly AI_CHAT_QUERY: 1;
};
export type AiOperationType = keyof typeof AI_OPERATION_COSTS;
/** Human-readable labels for ledger descriptions and the usage history UI. */
export declare const AI_OPERATION_LABELS: Record<AiOperationType, string>;
export declare function isAiOperationType(value: unknown): value is AiOperationType;
export declare function costForOperation(operationType: AiOperationType): number;
