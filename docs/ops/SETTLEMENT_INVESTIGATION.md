# Investigating an unresolved AI settlement

**Use this when:** the Next.js logs show `[billing] SETTLEMENT_PROBE_UNRESOLVED`, or a user reports being charged for an
answer they never received.

**What the event means:** the BFF tried every capture attempt and then every refund-probe attempt, and none gave an
authoritative result. The answer was **withheld**. The BFF does not know whether the user was charged, and neither does
this log line. **The database decides.**

> **Never call `/capture` or `/refund` by hand, and never repeat a settlement because a probe timed out.** The investigation
> below only reads. A timed-out probe is not evidence that a capture failed.

## 1. Take the reference from the event

```text
[billing] SETTLEMENT_PROBE_UNRESOLVED { event, referenceId, probeOutcome: 'unresolved', captureClassification,
  captureHttpStatus, captureAttempts, probeHttpStatus, probeAttempts, failureCategory, answerDelivery: 'withheld', occurredAt }
```

`captureHttpStatus` and `probeHttpStatus` are `null` when no complete HTTP response arrived.

| `failureCategory` | What ended the probe |
| --- | --- |
| `probe_response_lost` | Connection failure, timeout, or a body that broke off |
| `probe_service_unavailable` | A 5xx or 429 on the last attempt |
| `probe_rejected` | Any other non-2xx. A `403` or `404` usually means a secret differs between the services, so check `INTERNAL_AUTH_REJECTED` and `SETTLEMENT_AUTH_REJECTED` too |
| `probe_malformed_response` | A 2xx with no outcome the contract knows |
| `probe_not_sent` | The BFF lost its billing configuration mid-turn, so nothing was sent |

`captureClassification` is the last capture attempt: `response_lost`, `gateway_no_service_code`,
`capture_indeterminate_unknown`, `transient_database_error` or `database_unavailable`.

## 2. Read the authoritative state

Run this with the owner URL from a SQL console, replacing `<reference id>` in both places. The transaction is `READ ONLY`,
so PostgreSQL refuses any write.

```sql
BEGIN READ ONLY;
SELECT h.reference_id, h.user_id, h.status, h.amount, h.operation_type, h.created_at, h.expires_at, h.settled_at, h.settle_reason,
       l.id AS ledger_row_id, l.amount AS ledger_amount, l.created_at AS ledger_created_at
FROM ai_credit_holds h
LEFT JOIN credit_ledger_transactions l ON l.id = h.ledger_id
WHERE h.reference_id = '<reference id>';
SELECT id, user_id, transaction_type, amount, reference_id, created_at
FROM credit_ledger_transactions
WHERE reference_id IN ('<reference id>', 'settlement-goodwill-<reference id>');
ROLLBACK;
```

## 3. Interpret it

An event together with any row below means **the answer was withheld**. Without an event, a `captured` row is a normal turn.

| `status` | Ledger | What it means | What to do |
| --- | --- | --- | --- |
| `captured` | One `CREDIT_CONSUMPTION` row | Charged, and the answer was withheld | **The one case that needs a person: go to §4** |
| `held` | None | Not settled, nothing charged so far. A capture that was still in flight could still commit before `expires_at` | Do nothing. Re-run §2 after `expires_at` |
| `released` | None | Not charged. `settle_reason = capture_unconfirmed` means the probe did release it, and only its answer was lost | None. The user can ask again |
| `expired` | None | Not charged. Listed by `db:reconcile` as `hold_expired_unsettled` | Handle as that issue (runbook §9) |
| `capture_failed` | None | Not charged, and the capture failed for certain. Listed by `db:reconcile` as `capture_failed` | Handle as that issue (runbook §9) |
| No row | None | No reservation has this reference | Check you copied the reference. If it is correct, escalate as a defect: the BFF only reports references it reserved |

**Any other combination, such as `captured` with no ledger row or a debit with a non-`captured` hold: stop and escalate.**
Run `db:reconcile`, change nothing.

**What a state does not prove:** `captured` means the debit committed. It does **not** mean the answer reached the user.
`released`, `expired` and `capture_failed` mean no capture debit exists for this reference.

## 4. The charged, withheld case

Refunding through the API cannot help, by design: a captured reservation is never released. Crediting the user back is an
**owner decision**, made once per reference, outside this investigation.

If the owner decides to credit the user, use the existing compensating entry (runbook §9) with this exact reference:

```text
SELECT post_credit_transaction('<user id>', <amount>, 'ADMIN_ADJUSTMENT', 'settlement-goodwill-<reference id>');
```

**Nothing in the database prevents a second posting.** The ledger's unique index covers only `CREDIT_CONSUMPTION` and
`CREDIT_REFUND`, so a repeated `ADMIN_ADJUSTMENT` succeeds and credits the user twice. Re-run §2 immediately before posting:
if it shows an `ADMIN_ADJUSTMENT` row with this reference, the user has already been credited, so stop. Only one person should
handle a given reference at a time.

## 5. What this visibility does and does not cover

- **Log-based, not durable.** The event lives only in the Next.js logs. If they rotate before anyone looks, the charged,
  withheld case cannot be found afterwards, because its row looks exactly like a normal delivered turn. **Alert on the event
  as it happens**, and see the log retention table in `LAUNCH_CHECKLIST.md` §5.3.
- **`db:reconcile` does not report this case**, and an exit `0` does not rule it out. It does eventually report the uncharged
  variant, as `hold_expired_unsettled`.
- **Older `[billing] CAPTURE_FAILED` meaning:** a `CAPTURE_FAILED` with no probe and a status other than `409` (a `504`, for
  example) can also hide a committed capture. If a user reports a charge with no answer, run §2 for that reference too.
