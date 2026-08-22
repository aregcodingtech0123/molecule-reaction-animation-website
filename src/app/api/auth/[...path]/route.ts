import { createGatewayRouteHandlers } from "@/lib/gateway";

/**
 * BFF Gateway: /api/auth/* → AUTH_SERVICE_URL (Node.js/Express)
 *
 * Example:
 *   POST /api/auth/login     →  {AUTH_SERVICE_URL}/login
 *   GET  /api/auth/me        →  {AUTH_SERVICE_URL}/me
 */
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = createGatewayRouteHandlers("auth");
