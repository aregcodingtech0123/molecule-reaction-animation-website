/**
 * Credit price list — shared client/server display source of truth.
 * The billing service re-derives the real cost on every charge.
 */
export const AI_OPERATION_COSTS = {
  ATOM_GENERATE: 2,
  ARCH_RENDER_STD: 5,
  ARCH_RENDER_HD: 10,
  AI_CHAT_QUERY: 1,
} as const;

export type AiOperationType = keyof typeof AI_OPERATION_COSTS;
