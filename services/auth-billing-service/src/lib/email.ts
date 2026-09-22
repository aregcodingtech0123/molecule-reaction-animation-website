import { env } from "../config/env.js";

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
    const body = await res.text().catch(() => "");
    console.error("[email] Resend API error:", res.status, body);
    throw new Error("Failed to send email.");
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
