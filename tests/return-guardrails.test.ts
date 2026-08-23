import { afterEach, describe, expect, test } from "vitest";
import { resetPendingReturnActionsForTests } from "@/lib/guardrails/return-actions";
import { resetMockSessionsForTests, signInAsCustomer } from "@/lib/session/session";
import { confirmReturn, createReturn, prepareReturn, resetMockToolStateForTests } from "@/lib/tools/bookly-tools";

afterEach(() => {
  resetMockSessionsForTests();
  resetMockToolStateForTests();
  resetPendingReturnActionsForTests();
});

function signIn(customerId: string): string {
  const result = signInAsCustomer(customerId);

  if (!result.success) {
    throw new Error(`Expected ${customerId} to be a seeded customer.`);
  }

  return result.session.sessionId;
}

describe("return guardrails", () => {
  test("executes an eligible return after a session-owned confirmation", () => {
    const sessionId = signIn("CUST-001");
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "No longer needed");

    if (!proposal.success) {
      throw new Error("Expected an eligible return proposal.");
    }

    expect(confirmReturn(sessionId, proposal.pendingAction.actionId).success).toBe(true);
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toMatchObject({
      success: true,
      returnRecord: { returnId: "RMA-1842" },
    });
  });

  test("does not execute an eligible return without confirmation", () => {
    const sessionId = signIn("CUST-001");
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "No longer needed");

    if (!proposal.success) {
      throw new Error("Expected an eligible return proposal.");
    }

    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_REQUIRES_CONFIRMATION",
    });
  });

  test("rejects expired and already-returned items before creating a pending action", () => {
    const sessionId = signIn("CUST-001");

    expect(prepareReturn(sessionId, "ORD-1010", "ITEM-SEA-01", "No longer needed")).toEqual({
      success: false,
      errorCode: "RETURN_WINDOW_EXPIRED",
    });
    expect(prepareReturn(sessionId, "ORD-0988", "ITEM-KLARA-01", "No longer needed")).toEqual({
      success: false,
      errorCode: "ITEM_ALREADY_RETURNED",
    });
  });

  test("does not let another customer's session confirm or execute a pending action", () => {
    const sarahSession = signIn("CUST-001");
    const danielSession = signIn("CUST-002");
    const proposal = prepareReturn(sarahSession, "ORD-1031", "ITEM-WOLF-01", "No longer needed");

    if (!proposal.success) {
      throw new Error("Expected an eligible return proposal.");
    }

    expect(confirmReturn(danielSession, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "PENDING_ACTION_NOT_ACCESSIBLE",
    });
    expect(createReturn(danielSession, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "PENDING_ACTION_NOT_ACCESSIBLE",
    });
  });
});
