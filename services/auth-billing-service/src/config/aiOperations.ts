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
} as const;

export type AiOperationType = keyof typeof AI_OPERATION_COSTS;

/** Human-readable labels for ledger descriptions and the usage history UI. */
export const AI_OPERATION_LABELS: Record<AiOperationType, string> = {
  ATOM_GENERATE: "Atom Generation",
  ARCH_RENDER_STD: "Architecture Render (Standard)",
  ARCH_RENDER_HD: "Architecture Render (HD)",
  AI_CHAT_QUERY: "AI Chat Query",
};

export function isAiOperationType(value: unknown): value is AiOperationType {
  return typeof value === "string" && Object.hasOwn(AI_OPERATION_COSTS, value);
}

export function costForOperation(operationType: AiOperationType): number {
  return AI_OPERATION_COSTS[operationType];
}
