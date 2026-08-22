import { createGatewayRouteHandlers } from "@/lib/gateway";

/**
 * BFF Gateway: /api/billing/* → BILLING_SERVICE_URL (Node.js/Express)
 *
 * Example:
 *   GET  /api/billing/plans        →  {BILLING_SERVICE_URL}/plans
 *   POST /api/billing/subscribe    →  {BILLING_SERVICE_URL}/subscribe
 */
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = createGatewayRouteHandlers("billing");
