import { afterEach, describe, expect, test } from "vitest";
import { resetMockSessionsForTests, signInAsCustomer } from "@/lib/session/session";
import {
  checkReturnEligibility,
  confirmReturn,
  createReturn,
  escalateToHuman,
  getCustomerProfile,
  getOrderDetails,
  getOrderStatus,
  getRecentOrders,
  getRefundStatus,
  lookupPolicy,
  prepareReturn,
  prepareReturns,
  resetMockToolStateForTests,
} from "@/lib/tools/bookly-tools";
import { resetPendingReturnActionsForTests } from "@/lib/guardrails/return-actions";

afterEach(() => {
  resetMockSessionsForTests();
  resetMockToolStateForTests();
  resetPendingReturnActionsForTests();
});

function signInSarah(): string {
  const result = signInAsCustomer("CUST-001");

  if (!result.success) {
    throw new Error("Sarah must be able to sign in.");
  }

  return result.session.sessionId;
}

describe("Bookly tools", () => {
  test("returns an authenticated customer profile and recent orders", () => {
    const sessionId = signInSarah();

    expect(getCustomerProfile(sessionId)).toMatchObject({
      success: true,
      customer: { customerId: "CUST-001", firstName: "Sarah" },
    });
    const recentOrders = getRecentOrders(sessionId);

    expect(recentOrders.success).toBe(true);
    if (recentOrders.success) {
      expect(recentOrders.orders[0]).toMatchObject({ orderId: "ORD-1048" });
    }
  });

  test("returns authoritative shipping status for Sarah's order", () => {
    const result = getOrderStatus(signInSarah(), "ORD-1048");

    expect(result).toEqual({
      success: true,
      orderId: "ORD-1048",
      status: "shipped",
      carrier: "Royal Mail",
      trackingNumber: "RM-847201993",
      expectedDelivery: "2026-08-22",
    });
  });

  test("blocks order details for another customer", () => {
    expect(getOrderDetails(signInSarah(), "ORD-2042")).toEqual({
      success: false,
      errorCode: "ORDER_NOT_ACCESSIBLE",
    });
  });

  test("checks Sarah's eligible and expired return scenarios", () => {
    const sessionId = signInSarah();

    expect(checkReturnEligibility(sessionId, "ORD-1031", "ITEM-WOLF-01")).toEqual({
      success: true,
      eligible: true,
      orderId: "ORD-1031",
      itemId: "ITEM-WOLF-01",
      refundAmount: 18.99,
      returnDeadline: "2026-09-12",
    });
    expect(checkReturnEligibility(sessionId, "ORD-1010", "ITEM-SEA-01")).toEqual({
      success: false,
      errorCode: "RETURN_WINDOW_EXPIRED",
    });
  });

  test("rejects a duplicate return and a return for an undelivered order", () => {
    const sessionId = signInSarah();

    expect(checkReturnEligibility(sessionId, "ORD-0988", "ITEM-KLARA-01")).toEqual({
      success: false,
      errorCode: "ITEM_ALREADY_RETURNED",
    });
    expect(checkReturnEligibility(sessionId, "ORD-1048", "ITEM-ORB-01")).toEqual({
      success: false,
      errorCode: "ORDER_NOT_DELIVERED",
    });
  });

  test("creates a mocked return only after explicit confirmation", () => {
    const sessionId = signInSarah();
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "No longer needed");

    expect(proposal).toMatchObject({
      success: true,
      pendingAction: {
        actionId: "RETURN-ACTION-1",
        status: "awaiting_confirmation",
        expectedRefund: 18.99,
      },
    });

    if (!proposal.success) {
      throw new Error("The eligible return should create a pending action.");
    }

    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_REQUIRES_CONFIRMATION",
    });

    expect(confirmReturn(sessionId, proposal.pendingAction.actionId)).toMatchObject({
      success: true,
      pendingAction: { status: "confirmed" },
    });

    const createdReturn = createReturn(sessionId, proposal.pendingAction.actionId);

    expect(createdReturn).toMatchObject({
      success: true,
      returnRecord: {
        returnId: "RMA-1842",
        status: "registered",
        refundAmount: 18.99,
      },
    });
    expect(getRefundStatus(sessionId, "ORD-1031")).toMatchObject({
      success: true,
      refund: { returnId: "RMA-1842", status: "registered" },
    });
  });

  test("groups multiple eligible items from one order into one return request", () => {
    const sessionId = signInSarah();
    const proposal = prepareReturns(
      sessionId,
      "ORD-1031",
      ["ITEM-WOLF-01", "ITEM-MIDNIGHT-01"],
      "Customer requested return",
    );

    expect(proposal).toMatchObject({
      success: true,
      pendingAction: {
        itemIds: ["ITEM-WOLF-01", "ITEM-MIDNIGHT-01"],
        expectedRefund: 29.98,
        status: "awaiting_confirmation",
      },
    });

    if (!proposal.success) {
      throw new Error("Expected a grouped return proposal.");
    }

    expect(confirmReturn(sessionId, proposal.pendingAction.actionId).success).toBe(true);
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toMatchObject({
      success: true,
      returnRecord: { returnId: "RMA-1842", itemId: "ITEM-WOLF-01" },
    });
    expect(getRefundStatus(sessionId, "ORD-1031")).toMatchObject({
      success: true,
      refund: { returnId: "RMA-1842", refundAmount: 18.99 },
    });
  });

  test("returns an existing refund and controlled failures for missing data", () => {
    const sessionId = signInSarah();

    expect(getRefundStatus(sessionId, "ORD-0988")).toMatchObject({
      success: true,
      refund: { returnId: "RMA-1734", status: "refunded" },
    });
    expect(getRefundStatus(sessionId, "ORD-1031")).toEqual({
      success: false,
      errorCode: "REFUND_NOT_FOUND",
    });
    expect(getOrderStatus("invalid-session", "ORD-1048")).toEqual({
      success: false,
      errorCode: "UNAUTHENTICATED",
    });
  });

  test("looks up a Bookly policy and creates a contextual escalation ticket", () => {
    const sessionId = signInSarah();

    expect(lookupPolicy("How long do refunds take?")).toMatchObject({
      success: true,
      policy: { policyId: "POL-REFUNDS" },
    });
    expect(escalateToHuman(sessionId, "unverified_return", "Customer reports a return from three weeks ago.")).toEqual({
      success: true,
      ticket: {
        ticketId: "SUP-9321",
        customerId: "CUST-001",
        status: "queued",
        reason: "unverified_return",
        summary: "Customer reports a return from three weeks ago.",
        createdAt: "2026-08-21",
      },
    });
  });
});
