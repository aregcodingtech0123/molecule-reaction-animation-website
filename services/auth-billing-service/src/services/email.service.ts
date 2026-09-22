import { Resend } from "resend";
import { env } from "../config/env.js";

export interface PurchaseReceiptParams {
  userEmail: string;
  userName: string;
  creditsAdded: number;
  orderId: string;
  amountPaid: number;
  /** Current balance after the purchase was applied. */
  newBalance: number;
  currency?: string;
}

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = env.resendApiKey;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function buildPurchaseReceiptHtml(params: PurchaseReceiptParams): string {
  const name = escapeHtml(params.userName.trim() || "there");
  const orderId = escapeHtml(params.orderId);
  const credits = params.creditsAdded.toLocaleString("en-US");
  const balance = params.newBalance.toLocaleString("en-US");
  const paid = escapeHtml(formatMoney(params.amountPaid, params.currency ?? "USD"));
  const dashboardUrl = `${env.frontendUrl}/dashboard`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Purchase receipt — MoleculeStudio</title>
</head>
<body style="margin:0;padding:0;background:#05070b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070b;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0c1015;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 12px;border-bottom:1px solid rgba(45,212,191,0.18);">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2dd4bf;">MoleculeStudio</p>
              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;color:#f8fafc;">Purchase receipt</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#cbd5e1;">Hi ${name},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#94a3b8;">
                Thanks for your purchase. Your AI credits have been added to your account.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#131920;border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:20px;">
                <tr>
                  <td style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Order ID</p>
                    <p style="margin:6px 0 0;font-size:14px;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${orderId}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Amount paid</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#f8fafc;">${paid}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Credits added</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#2dd4bf;">+${credits}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">New balance</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#5eead4;">${balance} credits</p>
                  </td>
                </tr>
              </table>

              <a href="${escapeHtml(dashboardUrl)}"
                 style="display:inline-block;padding:12px 18px;border-radius:999px;background:rgba(45,212,191,0.15);border:1px solid rgba(45,212,191,0.45);color:#99f6e4;text-decoration:none;font-size:14px;font-weight:600;">
                View dashboard →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
                This is an automated receipt from MoleculeStudio. If you did not make this purchase, contact support.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPurchaseReceiptText(params: PurchaseReceiptParams): string {
  const name = params.userName.trim() || "there";
  const paid = formatMoney(params.amountPaid, params.currency ?? "USD");
  return [
    `Hi ${name},`,
    ``,
    `Thanks for your MoleculeStudio purchase.`,
    ``,
    `Order ID: ${params.orderId}`,
    `Amount paid: ${paid}`,
    `Credits added: +${params.creditsAdded}`,
    `New balance: ${params.newBalance} credits`,
    ``,
    `Dashboard: ${env.frontendUrl}/dashboard`,
    ``,
    `This is an automated receipt.`,
  ].join("\n");
}

/**
 * Sends a branded purchase receipt via Resend.
 * Safe to call fire-and-forget — logs and returns on failure; never throws to callers
 * that wrap it, but may throw if you await it (callers should catch).
 */
export async function sendPurchaseReceiptEmail(
  userEmail: string,
  userName: string,
  creditsAdded: number,
  orderId: string,
  amountPaid: number,
  newBalance = 0,
  currency = "USD",
): Promise<void> {
  const params: PurchaseReceiptParams = {
    userEmail,
    userName,
    creditsAdded,
    orderId,
    amountPaid,
    newBalance,
    currency,
  };

  const subject = `MoleculeStudio receipt — +${creditsAdded} credits`;
  const html = buildPurchaseReceiptHtml(params);
  const text = buildPurchaseReceiptText(params);
  const from = env.senderEmail;

  const client = getResendClient();
  if (!client) {
    if (env.isProduction) {
      throw new Error("RESEND_API_KEY is required in production to send email.");
    }
    console.warn("[email] RESEND_API_KEY unset — logging purchase receipt (dev only):", {
      to: userEmail,
      subject,
      text,
    });
    return;
  }

  const { error } = await client.emails.send({
    from,
    to: [userEmail],
    subject,
    html,
    text,
  });

  if (error) {
    console.error("[email] Resend purchase receipt failed:", error);
    throw new Error(error.message || "Failed to send purchase receipt email.");
  }
}
