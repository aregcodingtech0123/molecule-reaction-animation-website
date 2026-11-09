import { withTransaction } from "../db/index.js";
import { AppError } from "../types/index.js";
import { matchesHoldRow, type SettlementClaims } from "../utils/settlementCapability.js";
import { HOLD_SECONDS_COLUMNS, settlementNotAuthorized } from "./aiCredits.service.js";

/**
 * Delivery-attempt bookkeeping (Phase 2C step 5.2.2). The BFF calls this once it has a CONFIRMED capture and is about to
 * return the answer: "the BFF attempted to return the answer". It does not prove the client received, rendered or read it.
 *
 * This is deliberately apart from capture and release. It never calls post_credit_transaction, never writes the ledger or the
 * balance, never changes `status`, and never takes the per-user advisory lock that settlement uses. The only thing it writes
 * is `answer_delivery_attempted_at`, once, on a captured reservation that was created with delivery tracking on.
 *
 * The hold row is read under FOR UPDATE and is authoritative for everything: the signed claims only prove which reservation
 * the caller is talking about (matchesHoldRow), exactly as for capture and refund.
 */

export interface DeliveryAttemptResult {
  recorded: true;
  /** True when an earlier call already recorded it. The original timestamp is never overwritten. */
  alreadyRecorded: boolean;
}

/** One answer for every state that cannot be acknowledged, so the body reveals nothing about the reservation's status. */
function notRecordable(): AppError {
  return new AppError(409, "A delivery attempt cannot be recorded for this operation.", "DELIVERY_ATTEMPT_NOT_RECORDABLE");
}

interface AckRow {
  status: string;
  amount: number;
  operation_type: string;
  user_id: string;
  reference_id: string;
  delivery_tracking_enabled: boolean;
  already_recorded: boolean;
  created_at_s: number;
  expires_at_s: number;
}

/**
 * @param claims verified delivery_ack claims (set by requireSettlementCapability): the user and reference come from them only
 * @throws 404 HOLD_NOT_FOUND            — no reservation for the signed user and reference
 * @throws 403 SETTLEMENT_NOT_AUTHORIZED — the claims do not match the row; nothing changes
 * @throws 409 DELIVERY_ATTEMPT_NOT_RECORDABLE — not captured, or tracking was never enabled for it; nothing changes
 */
export async function recordDeliveryAttempt(claims: SettlementClaims): Promise<DeliveryAttemptResult> {
  // The middleware already checked the purpose. Checked again here, because this function is the one that writes.
  if (claims.pur !== "delivery_ack") throw settlementNotAuthorized();

  return withTransaction(async (client) => {
    const { rows } = await client.query<AckRow>(
      `SELECT status, amount, operation_type, user_id::text, reference_id, delivery_tracking_enabled,
              answer_delivery_attempted_at IS NOT NULL AS already_recorded, ${HOLD_SECONDS_COLUMNS}
       FROM ai_credit_holds
       WHERE user_id = $1 AND reference_id = $2
       FOR UPDATE`,
      [claims.sub, claims.ref],
    );
    const hold = rows[0];
    if (!hold) throw new AppError(404, "No reservation for this operation.", "HOLD_NOT_FOUND");

    const match = matchesHoldRow(claims, {
      userId: hold.user_id,
      referenceId: hold.reference_id,
      amount: hold.amount,
      operationType: hold.operation_type,
      createdAtSeconds: hold.created_at_s,
      expiresAtSeconds: hold.expires_at_s,
    });
    if (!match.ok) {
      console.error("[settlement] SETTLEMENT_AUTH_REJECTED", { purpose: claims.pur, reason: "row_mismatch", field: match.field, referenceId: claims.ref });
      throw settlementNotAuthorized();
    }

    if (hold.status !== "captured" || hold.delivery_tracking_enabled !== true) throw notRecordable();
    if (hold.already_recorded) return { recorded: true, alreadyRecorded: true };

    // The state is re-asserted in the statement itself. With the row locked it cannot have changed, so a miss here is a defect.
    const written = await client.query(
      `UPDATE ai_credit_holds
       SET answer_delivery_attempted_at = NOW()
       WHERE user_id = $1 AND reference_id = $2
         AND status = 'captured' AND delivery_tracking_enabled AND answer_delivery_attempted_at IS NULL`,
      [claims.sub, claims.ref],
    );
    if (written.rowCount !== 1) throw notRecordable();
    return { recorded: true, alreadyRecorded: false };
  });
}
