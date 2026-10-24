/** No-op dotenv used by tests so services/auth-billing-service/.env is never read. */
export function config() {
  return { parsed: {} };
}

export default { config };
