/**
 * Credit price list for every metered AI operation.
 *
 * This is the single source of truth. The frontend never sends a price — it
 * sends an operation name and the server looks the cost up here, so a tampered
 * client cannot buy a HD render for the price of a chat message.
 */
export const AI_OPERATION_COSTS = {
    ATOM_GENERATE: 2,
    ARCH_RENDER_STD: 5,
    ARCH_RENDER_HD: 10,
    AI_CHAT_QUERY: 1,
};
/** Human-readable labels for ledger descriptions and the usage history UI. */
export const AI_OPERATION_LABELS = {
    ATOM_GENERATE: "Atom Generation",
    ARCH_RENDER_STD: "Architecture Render (Standard)",
    ARCH_RENDER_HD: "Architecture Render (HD)",
    AI_CHAT_QUERY: "AI Chat Query",
};
export function isAiOperationType(value) {
    return typeof value === "string" && Object.hasOwn(AI_OPERATION_COSTS, value);
}
export function costForOperation(operationType) {
    return AI_OPERATION_COSTS[operationType];
}
//# sourceMappingURL=aiOperations.js.map