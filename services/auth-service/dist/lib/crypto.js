import bcrypt from "bcrypt";
import { env } from "../config/env.js";
export async function hashPassword(plain) {
    return bcrypt.hash(plain, env.bcryptRounds);
}
export async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}
//# sourceMappingURL=crypto.js.map