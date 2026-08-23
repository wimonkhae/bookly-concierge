import { policies, returns, supportTickets } from "@/data/bookly";
import { getOrderForCustomer, getOrdersForCustomer } from "@/lib/bookly/repository";
import {
  confirmPendingReturnAction,
  createPendingReturnAction,
  getConfirmedPendingReturnAction,
  markPendingReturnActionAwaitingFollowUp,
  type PendingReturnAction,
} from "@/lib/guardrails/return-actions";
import { getAuthenticatedCustomer } from "@/lib/session/session";
import type { Order, Policy, ReturnRecord, SupportTicket } from "@/lib/bookly/types";

const DEMO_DATE = "2026-08-21";

const seededReturns = returns.map((record) => ({ ...record }));
let nextReturnNumber = 1842;
let nextTicketNumber = 9321;

export type ToolErrorCode =
  | "UNAUTHENTICATED"
  | "ORDER_NOT_ACCESSIBLE"
  | "ORDER_NOT_DELIVERED"
  | "ITEM_NOT_FOUND"
  | "ITEM_NOT_RETURNABLE"
  | "ITEM_ALREADY_RETURNED"
  | "RETURN_WINDOW_EXPIRED"
  | "REFUND_NOT_FOUND"
  | "POLICY_NOT_FOUND"
  | "REASON_REQUIRED"
  | "ESCALATION_REASON_REQUIRED"
  | "PENDING_ACTION_NOT_FOUND"
  | "PENDING_ACTION_NOT_ACCESSIBLE"
  | "ACTION_REQUIRES_CONFIRMATION"
  | "ACTION_NOT_ACTIVE"
  | "RETURN_ALREADY_PENDING";

type ToolFailure = {
  success: false;
  errorCode: ToolErrorCode;
};

type ToolSuccess<T> = { success: true } & T;

type OwnedOrderResult = ToolSuccess<{ customerId: string; order: Order }> | ToolFailure;

export type ReturnEligibility = ToolSuccess<{
  eligible: true;
  orderId: string;
  itemId: string;
  refundAmount: number;
  returnDeadline: string;
}>;

export type ReturnEligibilityResult = ReturnEligibility | ToolFailure;

function getCustomerForSession(sessionId: string) {
  const customer = getAuthenticatedCustomer(sessionId);

  return customer ? ({ success: true, customer } as const) : ({ success: false, errorCode: "UNAUTHENTICATED" } as const);
}

function getOwnedOrder(sessionId: string, orderId: string): OwnedOrderResult {
  const customerResult = getCustomerForSession(sessionId);

  if (!customerResult.success) {
    return customerResult;
  }

  const order = getOrderForCustomer(customerResult.customer.customerId, orderId);

  if (!order) {
    return { success: false, errorCode: "ORDER_NOT_ACCESSIBLE" };
  }

  return { success: true, customerId: customerResult.customer.customerId, order };
}

function getReturnDeadline(deliveredAt: string): string {
  const deadline = new Date(`${deliveredAt}T00:00:00.000Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 30);

  return deadline.toISOString().slice(0, 10);
}

function hasExistingReturn(customerId: string, orderId: string, itemId: string): boolean {
  return returns.some(
    (record) =>
      record.customerId === customerId && record.orderId === orderId && record.itemId === itemId,
  );
}

export function getCustomerProfile(sessionId: string): ToolSuccess<{ customer: ReturnType<typeof getAuthenticatedCustomer> }> | ToolFailure {
  const customerResult = getCustomerForSession(sessionId);

  if (!customerResult.success) {
    return customerResult;
  }

  return { success: true, customer: customerResult.customer };
}

export function getRecentOrders(sessionId: string): ToolSuccess<{ orders: Order[] }> | ToolFailure {
  const customerResult = getCustomerForSession(sessionId);

  if (!customerResult.success) {
    return customerResult;
  }

  return { success: true, orders: getOrdersForCustomer(customerResult.customer.customerId) };
}

export function getOrderStatus(
  sessionId: string,
  orderId: string,
): ToolSuccess<{
  orderId: string;
  status: Order["status"];
  carrier?: string;
  trackingNumber?: string;
  expectedDelivery?: string;
}> | ToolFailure {
  const orderResult = getOwnedOrder(sessionId, orderId);

  if (!orderResult.success) {
    return orderResult;
  }

  const { order } = orderResult;

  return {
    success: true,
    orderId: order.orderId,
    status: order.status,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    expectedDelivery: order.expectedDelivery,
  };
}

export function getOrderDetails(
  sessionId: string,
  orderId: string,
): ToolSuccess<{ order: Order }> | ToolFailure {
  const orderResult = getOwnedOrder(sessionId, orderId);

  return orderResult.success ? { success: true, order: orderResult.order } : orderResult;
}

export function checkReturnEligibility(
  sessionId: string,
  orderId: string,
  itemId: string,
): ReturnEligibilityResult {
  const orderResult = getOwnedOrder(sessionId, orderId);

  if (!orderResult.success) {
    return orderResult;
  }

  const { customerId, order } = orderResult;
  const item = order.items.find((candidate) => candidate.itemId === itemId);

  if (!item) {
    return { success: false, errorCode: "ITEM_NOT_FOUND" };
  }

  if (item.returnId || hasExistingReturn(customerId, orderId, itemId)) {
    return { success: false, errorCode: "ITEM_ALREADY_RETURNED" };
  }

  if (!item.returnable) {
    return { success: false, errorCode: "ITEM_NOT_RETURNABLE" };
  }

  if (order.status !== "delivered" || !order.deliveredAt) {
    return { success: false, errorCode: "ORDER_NOT_DELIVERED" };
  }

  const returnDeadline = getReturnDeadline(order.deliveredAt);

  if (DEMO_DATE > returnDeadline) {
    return { success: false, errorCode: "RETURN_WINDOW_EXPIRED" };
  }

  return {
    success: true,
    eligible: true,
    orderId,
    itemId,
    refundAmount: item.price,
    returnDeadline,
  };
}

export function prepareReturn(
  sessionId: string,
  orderId: string,
  itemId: string,
  reason: string,
): ToolSuccess<{ pendingAction: PendingReturnAction }> | ToolFailure {
  if (!reason.trim()) {
    return { success: false, errorCode: "REASON_REQUIRED" };
  }

  const eligibility = checkReturnEligibility(sessionId, orderId, itemId);

  if (!eligibility.success) {
    return eligibility;
  }

  const customerId = getAuthenticatedCustomer(sessionId)?.customerId;

  if (!customerId) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }

  return createPendingReturnAction({
    customerId,
    orderId,
    itemId,
    reason,
    expectedRefund: eligibility.refundAmount,
    returnDeadline: eligibility.returnDeadline,
  });
}

export function prepareReturns(
  sessionId: string,
  orderId: string,
  itemIds: string[],
  reason: string,
): ToolSuccess<{ pendingAction: PendingReturnAction }> | ToolFailure {
  const uniqueItemIds = [...new Set(itemIds)];

  if (!reason.trim() || uniqueItemIds.length === 0) {
    return { success: false, errorCode: "REASON_REQUIRED" };
  }

  const eligibilityResults = uniqueItemIds.map((itemId) => checkReturnEligibility(sessionId, orderId, itemId));
  const ineligible = eligibilityResults.find((result) => !result.success);

  if (ineligible && !ineligible.success) {
    return ineligible;
  }

  const customerId = getAuthenticatedCustomer(sessionId)?.customerId;

  if (!customerId) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }

  const eligibleItems = eligibilityResults.filter((result): result is ReturnEligibility => result.success);

  return createPendingReturnAction({
    customerId,
    orderId,
    itemId: uniqueItemIds[0],
    itemIds: uniqueItemIds,
    reason,
    expectedRefund: Number(eligibleItems.reduce((total, item) => total + item.refundAmount, 0).toFixed(2)),
    returnDeadline: eligibleItems.map((item) => item.returnDeadline).sort()[0],
  });
}

export function confirmReturn(
  sessionId: string,
  actionId: string,
): ToolSuccess<{ pendingAction: PendingReturnAction }> | ToolFailure {
  const customerId = getAuthenticatedCustomer(sessionId)?.customerId;

  if (!customerId) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }

  return confirmPendingReturnAction(customerId, actionId);
}

export function createReturn(
  sessionId: string,
  actionId: string,
): ToolSuccess<{ returnRecord: ReturnRecord }> | ToolFailure {
  const customerId = getAuthenticatedCustomer(sessionId)?.customerId;

  if (!customerId) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }

  const pendingResult = getConfirmedPendingReturnAction(customerId, actionId);

  if (!pendingResult.success) {
    return pendingResult;
  }

  const { pendingAction } = pendingResult;
  const itemIds = pendingAction.itemIds ?? [pendingAction.itemId];
  const eligibilityResults = itemIds.map((itemId) => checkReturnEligibility(sessionId, pendingAction.orderId, itemId));
  const ineligible = eligibilityResults.find((result) => !result.success);

  if (ineligible && !ineligible.success) {
    return ineligible;
  }

  const eligibleItems = eligibilityResults.filter((result): result is ReturnEligibility => result.success);
  const returnId = `RMA-${nextReturnNumber++}`;
  const returnRecords = eligibleItems.map<ReturnRecord>((eligibility) => ({
    returnId,
    orderId: pendingAction.orderId,
    itemId: eligibility.itemId,
    customerId,
    status: "registered",
    refundAmount: eligibility.refundAmount,
    createdAt: DEMO_DATE,
  }));

  returns.push(...returnRecords);
  markPendingReturnActionAwaitingFollowUp(customerId, actionId);

  return { success: true, returnRecord: returnRecords[0] };
}

export function getRefundStatus(
  sessionId: string,
  orderId: string,
): ToolSuccess<{ refund: ReturnRecord }> | ToolFailure {
  const orderResult = getOwnedOrder(sessionId, orderId);

  if (!orderResult.success) {
    return orderResult;
  }

  const refund = returns.find(
    (record) => record.customerId === orderResult.customerId && record.orderId === orderId,
  );

  return refund ? { success: true, refund } : { success: false, errorCode: "REFUND_NOT_FOUND" };
}

export function lookupPolicy(query: string): ToolSuccess<{ policy: Policy }> | ToolFailure {
  const words = query.toLowerCase().match(/[a-z]+/g) ?? [];
  const topicKeywords: Record<Policy["topic"], string[]> = {
    returns: ["return"],
    refunds: ["refund"],
    shipping: ["ship", "tracking", "delivery", "dispatch"],
    "damaged-items": ["damage", "damaged", "replacement"],
    "password-reset": ["password", "reset", "sign", "login"],
  };
  const matchedPolicy = policies
    .map((policy) => ({
      policy,
      score: words.filter((word) => topicKeywords[policy.topic].some((keyword) => word.startsWith(keyword))).length,
    }))
    .sort((left, right) => right.score - left.score)[0];

  return matchedPolicy?.score
    ? { success: true, policy: matchedPolicy.policy }
    : { success: false, errorCode: "POLICY_NOT_FOUND" };
}

export function escalateToHuman(
  sessionId: string,
  reason: string,
  conversationSummary: string,
): ToolSuccess<{ ticket: SupportTicket }> | ToolFailure {
  const customerResult = getCustomerForSession(sessionId);

  if (!customerResult.success) {
    return customerResult;
  }

  if (!reason.trim()) {
    return { success: false, errorCode: "ESCALATION_REASON_REQUIRED" };
  }

  const ticket: SupportTicket = {
    ticketId: `SUP-${nextTicketNumber++}`,
    customerId: customerResult.customer.customerId,
    status: "queued",
    reason,
    summary: conversationSummary,
    createdAt: DEMO_DATE,
  };

  supportTickets.push(ticket);

  return { success: true, ticket };
}

export function resetMockToolStateForTests(): void {
  returns.splice(0, returns.length, ...seededReturns.map((record) => ({ ...record })));
  supportTickets.splice(0, supportTickets.length);
  nextReturnNumber = 1842;
  nextTicketNumber = 9321;
}
