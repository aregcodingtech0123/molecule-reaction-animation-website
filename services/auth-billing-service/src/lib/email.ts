import { env } from "../config/env.js";
import { safeErrorLogFields } from "../db/diagnostics.js";

/** Resend's error codes are snake_case words (`validation_error`). Anything else is free text and is dropped. */
const PROVIDER_CODE = /^[a-z][a-z_]{1,63}$/;

/**
 * The mail provider refused a message. Holds only its HTTP status and its error code: the provider's message and response can echo
 * the recipient, the subject or the link being sent, so they are never kept, and the message here is fixed.
 */
export class EmailProviderError extends Error {
  readonly providerStatus: number | null;
  readonly providerCode: string | null;

  constructor(status: unknown, code: unknown) {
    super("Failed to send email.");
    this.name = "EmailProviderError";
    this.providerStatus = typeof status === "number" && Number.isInteger(status) ? status : null;
    this.providerCode = typeof code === "string" && PROVIDER_CODE.test(code) ? code : null;
  }
}

/** What to log for a failed mail, whichever step it failed at: the provider's refusal, the network, or the database before it. */
export function safeEmailErrorFields(err: unknown) {
  return {
    ...safeErrorLogFields(err),
    providerStatus: err instanceof EmailProviderError ? err.providerStatus : null,
    providerCode: err instanceof EmailProviderError ? err.providerCode : null,
  };
}

/** The `name` field of a Resend error body, or null for a body of any other shape. */
function providerCodeOf(body: string): unknown {
  try {
    return (JSON.parse(body) as { name?: unknown } | null)?.name ?? null;
  } catch {
    return null;
  }
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Transactional email via Resend HTTP API.
 * When RESEND_API_KEY is unset in development, logs the payload instead of failing hard
 * so local signup flows remain testable.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = env.resendApiKey;
  const from = env.senderEmail;

  if (!apiKey) {
    if (env.isProduction) {
      throw new Error("RESEND_API_KEY is required in production to send email.");
    }
    console.warn("[email] RESEND_API_KEY unset — logging email (dev only):", {
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const failure = new EmailProviderError(res.status, providerCodeOf(await res.text().catch(() => "")));
    // Status and code only: the body can echo request fields, including the link being mailed (SEC-19).
    console.error("[email] Resend API error:", { providerStatus: failure.providerStatus, providerCode: failure.providerCode });
    throw failure;
  }
}

export function buildVerificationEmail(params: {
  email: string;
  firstName: string;
  verifyUrl: string;
}): SendEmailParams {
  const name = params.firstName || "there";
  return {
    to: params.email,
    subject: "Verify your MoleculeStudio email",
    text: `Hi ${name},\n\nConfirm your email to unlock 10 free AI credits:\n${params.verifyUrl}\n\nThis link expires in 24 hours.\n`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Confirm your email to unlock <strong>10 free AI credits</strong> on MoleculeStudio.</p>
      <p><a href="${escapeAttr(params.verifyUrl)}">Verify email address</a></p>
      <p style="color:#64748b;font-size:12px">This link expires in 24 hours. If you did not create an account, ignore this message.</p>
    `,
  };
}

export function buildPasswordResetEmail(params: {
  email: string;
  resetUrl: string;
}): SendEmailParams {
  return {
    to: params.email,
    subject: "Reset your MoleculeStudio password",
    text: `Reset your password using this link (expires in 1 hour):\n${params.resetUrl}\n\nIf you did not request this, ignore this email.\n`,
    html: `
      <p>We received a password reset request for your MoleculeStudio account.</p>
      <p><a href="${escapeAttr(params.resetUrl)}">Reset password</a></p>
      <p style="color:#64748b;font-size:12px">This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
    `,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

export function buildDeletionRequestedEmail(params: {
  email: string;
  firstName: string;
  scheduledFor: Date;
  accountUrl: string;
}): SendEmailParams {
  const name = params.firstName || "there";
  const date = params.scheduledFor.toISOString().slice(0, 10);
  return {
    to: params.email,
    subject: "Your MoleculeStudio account is scheduled for deletion",
    text:
      `Hi ${name},\n\nYou asked us to delete your MoleculeStudio account. It will be deleted on ${date} (UTC). ` +
      `Your remaining credits are permanently lost at that point and cannot be restored.\n\n` +
      `Changed your mind? Sign in before then and choose "Cancel deletion" on your profile page:\n${params.accountUrl}\n\n` +
      `If you did not ask for this, sign in and cancel it, then change your password.\n`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>You asked us to delete your MoleculeStudio account. It will be deleted on <strong>${escapeHtml(date)} (UTC)</strong>. Your remaining credits are permanently lost at that point and cannot be restored.</p>
      <p>Changed your mind? Sign in before then and choose &ldquo;Cancel deletion&rdquo; on your <a href="${escapeAttr(params.accountUrl)}">profile page</a>.</p>
      <p style="color:#64748b;font-size:12px">If you did not ask for this, sign in and cancel it, then change your password.</p>
    `,
  };
}

