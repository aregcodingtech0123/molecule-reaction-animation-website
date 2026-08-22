import { cookies } from "next/headers";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_TOKEN_COOKIE);
  return Response.json({ success: true });
}
