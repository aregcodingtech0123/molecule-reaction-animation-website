import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(serviceRoot, ".env");
const result = dotenv.config({ path: envPath });
if (result.error && fs.existsSync(envPath)) {
    console.warn(`[env] Failed to parse ${envPath}:`, result.error.message);
}
else if (fs.existsSync(envPath)) {
    console.log(`[env] Loaded ${envPath}`);
}
else {
    console.warn(`[env] No .env file at ${envPath} — using process environment only`);
}
export { envPath, serviceRoot };
//# sourceMappingURL=loadEnv.js.map