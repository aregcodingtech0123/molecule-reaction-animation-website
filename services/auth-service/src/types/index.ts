export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function publicUser(user: {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  profile: { displayName: string; credits: number } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.profile?.displayName ?? null,
    credits: user.profile?.credits ?? 0,
    createdAt: user.createdAt.toISOString(),
  };
}

export type SafeUser = ReturnType<typeof publicUser>;
