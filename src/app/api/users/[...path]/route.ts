import { createGatewayRouteHandlers } from "@/lib/gateway";

/**
 * BFF Gateway: /api/users/* → USERS_SERVICE_URL (Node.js/Express)
 *
 * Example:
 *   GET /api/users/profile  →  {USERS_SERVICE_URL}/profile
 *   PUT /api/users/profile  →  {USERS_SERVICE_URL}/profile
 */
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = createGatewayRouteHandlers("users");
