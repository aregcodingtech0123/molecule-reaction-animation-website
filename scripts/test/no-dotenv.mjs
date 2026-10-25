/**
 * Test-only preload (`node --import …/no-dotenv.mjs`): resolves `dotenv` and `dotenv/config` to a
 * no-op module, so a service started by a test sees ONLY the environment the test passes and never
 * reads a developer's real `.env` file (no secret is read, nothing leaks into the test).
 *
 * Used by services/auth-billing-service/tests/api/production-startup.test.ts to boot the real
 * service with NODE_ENV=production.
 */
import { register } from "node:module";

const stub = `data:text/javascript,${encodeURIComponent(
  "const config = () => ({ parsed: {} }); export { config }; export default { config };",
)}`;

register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "dotenv" || specifier === "dotenv/config") {
    return { url: ${JSON.stringify(stub)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`)}`,
);
