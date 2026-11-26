/**
 * The shared provider-state reader and the two verdicts built on it (V8 contract Part P3.2, P3.3, P3.4; tests P-T1, P-T2). Pure; no
 * database.
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_DESCRIPTIONS,
  orderCreatedStateVerdict,
  readOrderPaymentState,
  refundEventVerdict,
  type OrderPaymentState,
} from "../../src/lib/lemonEvent.js";

describe("readOrderPaymentState (P-T1)", () => {
  it.each<[string, unknown, OrderPaymentState]>([
    ["paid, refunded false, no amount", { status: "paid", refunded: false }, "paid"],
    ["paid, refunded false, amount 0", { status: "paid", refunded: false, refunded_amount: 0 }, "paid"],
    ["paid, refunded false, amount null", { status: "paid", refunded: false, refunded_amount: null }, "paid"],
    ["paid, refunded absent", { status: "paid" }, "unknown"],
    ["paid, refunded null", { status: "paid", refunded: null }, "unknown"],
    ["paid, refunded as text", { status: "paid", refunded: "false" }, "unknown"],
    ["paid, refunded true", { status: "paid", refunded: true }, "unknown"],
    ["paid, a refunded amount", { status: "paid", refunded: false, refunded_amount: 5 }, "unknown"],
    ["paid, amount as text", { status: "paid", refunded: false, refunded_amount: "0" }, "unknown"],
    ["pending", { status: "pending" }, "not_paid"],
    ["failed, refunded false", { status: "failed", refunded: false, refunded_amount: 0 }, "not_paid"],
    ["pending but refunded true", { status: "pending", refunded: true }, "unknown"],
    ["failed with an amount", { status: "failed", refunded_amount: 10 }, "unknown"],
    ["pending, refunded as text", { status: "pending", refunded: "no" }, "unknown"],
    ["refunded, confirmed", { status: "refunded", refunded: true, refunded_amount: 500 }, "refunded"],
    ["refunded, flag absent", { status: "refunded", refunded_amount: 500 }, "unknown"],
    ["refunded, flag false", { status: "refunded", refunded: false, refunded_amount: 500 }, "unknown"],
    ["refunded, amount absent", { status: "refunded", refunded: true }, "unknown"],
    ["refunded, amount 0", { status: "refunded", refunded: true, refunded_amount: 0 }, "unknown"],
    ["refunded, fractional amount", { status: "refunded", refunded: true, refunded_amount: 1.5 }, "unknown"],
    ["refunded, negative amount", { status: "refunded", refunded: true, refunded_amount: -5 }, "unknown"],
    ["partial, confirmed", { status: "partial_refund", refunded: false, refunded_amount: 100 }, "partial_refund"],
    ["partial, flag true", { status: "partial_refund", refunded: true, refunded_amount: 100 }, "unknown"],
    ["partial, flag absent", { status: "partial_refund", refunded_amount: 100 }, "unknown"],
    ["partial, amount absent", { status: "partial_refund", refunded: false }, "unknown"],
    ["fraudulent", { status: "fraudulent" }, "fraudulent"],
    ["fraudulent with any fields", { status: "fraudulent", refunded: true, refunded_amount: 9 }, "fraudulent"],
    ["status absent", { refunded: false }, "unknown"],
    ["status not a string", { status: 1, refunded: false }, "unknown"],
    ["status in another case", { status: "PAID", refunded: false }, "unknown"],
    ["unknown vocabulary", { status: "chargeback", refunded: false }, "unknown"],
    ["no attributes", undefined, "unknown"],
    ["attributes null", null, "unknown"],
    ["attributes an array", [], "unknown"],
  ])("%s → %s", (_label, attributes, expected) => {
    expect(readOrderPaymentState(attributes)).toBe(expected);
  });

  it("refunded_at never classifies", () => {
    expect(readOrderPaymentState({ status: "paid", refunded: false, refunded_at: "2026-11-26T00:00:00Z" })).toBe("paid");
    expect(readOrderPaymentState({ status: "partial_refund", refunded: false, refunded_amount: 1, refunded_at: "2026-11-26T00:00:00Z" })).toBe(
      "partial_refund",
    );
  });
});

describe("order_created verdict (N-2, P3.3)", () => {
  it.each<[OrderPaymentState, ReturnType<typeof orderCreatedStateVerdict>]>([
    ["paid", { kind: "creditable" }],
    ["not_paid", { kind: "label", outcome: "order_not_paid" }],
    ["refunded", { kind: "label", outcome: "order_refunded" }],
    ["partial_refund", { kind: "review", description: "review:partial_refund" }],
    ["fraudulent", { kind: "review", description: "review:fraudulent_status" }],
    ["unknown", { kind: "review", description: "review:payment_state_unknown" }],
  ])("%s", (state, verdict) => {
    expect(orderCreatedStateVerdict(state)).toEqual(verdict);
  });
});

describe("order_refunded verdict (P3.3, P3.4; P-T2)", () => {
  it("a row only for a confirmed state, fully_refunded from the state", () => {
    expect(refundEventVerdict("refunded")).toEqual({ kind: "record", orderStatus: "refunded", fullyRefunded: true });
    expect(refundEventVerdict("partial_refund")).toEqual({ kind: "record", orderStatus: "partial_refund", fullyRefunded: false });
  });

  it.each<[OrderPaymentState, string]>([
    ["paid", "review:refund_event_state_mismatch"],
    ["not_paid", "review:refund_event_state_mismatch"],
    ["fraudulent", "review:fraudulent_status"],
    ["unknown", "review:payment_state_unknown"],
  ])("%s → review stop %s, no row", (state, description) => {
    expect(refundEventVerdict(state)).toEqual({ kind: "review", description });
  });

  it("a partial refund is never recorded as full, whatever the raw flag says", () => {
    const state = readOrderPaymentState({ status: "partial_refund", refunded: false, refunded_amount: 100 });
    expect(refundEventVerdict(state)).toMatchObject({ orderStatus: "partial_refund", fullyRefunded: false });
    // status refunded with refunded=false is not a full refund either: it is unknown and stops for review
    expect(refundEventVerdict(readOrderPaymentState({ status: "refunded", refunded: false, refunded_amount: 100 }))).toEqual({
      kind: "review",
      description: "review:payment_state_unknown",
    });
  });
});

describe("the fixed review descriptions (P4.3 and I-6 ii)", () => {
  it("is exactly the pinned list of nine", () => {
    expect(Object.values(REVIEW_DESCRIPTIONS).sort()).toEqual(
      [
        "review:blocked_by_review_decision",
        "review:fraudulent_status",
        "review:historical_credit_ambiguous",
        "review:partial_refund",
        "review:payload_cleared",
        "review:payment_state_unknown",
        "review:refund_before_credit",
        "review:refund_event_state_mismatch",
        "review:refund_evidence_conflict",
      ].sort(),
    );
  });
});
