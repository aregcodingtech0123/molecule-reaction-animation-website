import { cookies } from "next/headers";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/session";
import { verifyJwtToken } from "@/lib/auth/verify-jwt";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function allowedOrigins(): string[] {
  const frontend = process.env.FRONTEND_URL?.trim() || "http://localhost:3000";
  return [frontend, "http://localhost:3000", "http://127.0.0.1:3000"];
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return Response.json({ error: "Token is required." }, { status: 400 });
  }

  const session = await verifyJwtToken(token);
  if (!session) {
    return Response.json({ error: "Invalid token." }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return Response.json({ success: true });
}
