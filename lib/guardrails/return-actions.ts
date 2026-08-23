export type PendingReturnAction = {
  actionId: string;
  customerId: string;
  orderId: string;
  itemId: string;
  itemIds?: string[];
  reason: string;
  expectedRefund: number;
  returnDeadline: string;
  status: "awaiting_confirmation" | "confirmed" | "awaiting_follow_up" | "completed" | "cancelled";
  createdAt: string;
  confirmedAt?: string;
};

export type PendingReturnActionErrorCode =
  | "PENDING_ACTION_NOT_FOUND"
  | "PENDING_ACTION_NOT_ACCESSIBLE"
  | "ACTION_REQUIRES_CONFIRMATION"
  | "ACTION_NOT_ACTIVE"
  | "RETURN_ALREADY_PENDING";

type PendingReturnActionFailure = {
  success: false;
  errorCode: PendingReturnActionErrorCode;
};

type PendingReturnActionSuccess = {
  success: true;
  pendingAction: PendingReturnAction;
};

type PendingReturnActionResult = PendingReturnActionSuccess | PendingReturnActionFailure;

const pendingActions = new Map<string, PendingReturnAction>();
let nextActionNumber = 1;

function getActionForCustomer(
  customerId: string,
  actionId: string,
): PendingReturnActionResult {
  const pendingAction = pendingActions.get(actionId);

  if (!pendingAction) {
    return { success: false, errorCode: "PENDING_ACTION_NOT_FOUND" };
  }

  if (pendingAction.customerId !== customerId) {
    return { success: false, errorCode: "PENDING_ACTION_NOT_ACCESSIBLE" };
  }

  return { success: true, pendingAction: { ...pendingAction } };
}

export function createPendingReturnAction(
  input: Omit<PendingReturnAction, "actionId" | "status" | "createdAt" | "confirmedAt">,
): PendingReturnActionResult {
  const duplicate = [...pendingActions.values()].some(
    (action) =>
      action.customerId === input.customerId &&
      action.orderId === input.orderId &&
      action.itemId === input.itemId &&
      (action.status === "awaiting_confirmation" || action.status === "confirmed"),
  );

  if (duplicate) {
    return { success: false, errorCode: "RETURN_ALREADY_PENDING" };
  }

  const pendingAction: PendingReturnAction = {
    ...input,
    actionId: `RETURN-ACTION-${nextActionNumber++}`,
    status: "awaiting_confirmation",
    createdAt: new Date().toISOString(),
  };

  pendingActions.set(pendingAction.actionId, pendingAction);

  return { success: true, pendingAction: { ...pendingAction } };
}

export function confirmPendingReturnAction(
  customerId: string,
  actionId: string,
): PendingReturnActionResult {
  const result = getActionForCustomer(customerId, actionId);

  if (!result.success) {
    return result;
  }

  const pendingAction = pendingActions.get(actionId)!;

  if (pendingAction.status !== "awaiting_confirmation") {
    return { success: false, errorCode: "ACTION_NOT_ACTIVE" };
  }

  pendingAction.status = "confirmed";
  pendingAction.confirmedAt = new Date().toISOString();

  return { success: true, pendingAction: { ...pendingAction } };
}

export function getConfirmedPendingReturnAction(
  customerId: string,
  actionId: string,
): PendingReturnActionResult {
  const result = getActionForCustomer(customerId, actionId);

  if (!result.success) {
    return result;
  }

  if (result.pendingAction.status === "awaiting_confirmation") {
    return { success: false, errorCode: "ACTION_REQUIRES_CONFIRMATION" };
  }

  if (result.pendingAction.status !== "confirmed") {
    return { success: false, errorCode: "ACTION_NOT_ACTIVE" };
  }

  return result;
}

export function getSingleAwaitingPendingReturnAction(
  customerId: string,
): PendingReturnAction | undefined {
  const awaitingActions = [...pendingActions.values()].filter(
    (action) => action.customerId === customerId && action.status === "awaiting_confirmation",
  );

  return awaitingActions.length === 1 ? { ...awaitingActions[0] } : undefined;
}

export function getSingleAwaitingFollowUpAction(customerId: string): PendingReturnAction | undefined {
  const followUpActions = [...pendingActions.values()].filter(
    (action) => action.customerId === customerId && action.status === "awaiting_follow_up",
  );

  return followUpActions.length === 1 ? { ...followUpActions[0] } : undefined;
}

export function cancelPendingReturnAction(
  customerId: string,
  actionId: string,
): PendingReturnActionResult {
  const result = getActionForCustomer(customerId, actionId);

  if (!result.success) {
    return result;
  }

  const pendingAction = pendingActions.get(actionId)!;

  if (pendingAction.status !== "awaiting_confirmation") {
    return { success: false, errorCode: "ACTION_NOT_ACTIVE" };
  }

  pendingAction.status = "cancelled";

  return { success: true, pendingAction: { ...pendingAction } };
}

export function markPendingReturnActionAwaitingFollowUp(
  customerId: string,
  actionId: string,
): PendingReturnActionResult {
  const result = getConfirmedPendingReturnAction(customerId, actionId);

  if (!result.success) {
    return result;
  }

  const pendingAction = pendingActions.get(actionId)!;
  pendingAction.status = "awaiting_follow_up";

  return { success: true, pendingAction: { ...pendingAction } };
}

export function completeReturnFollowUp(customerId: string, actionId: string): PendingReturnActionResult {
  const result = getActionForCustomer(customerId, actionId);

  if (!result.success) {
    return result;
  }

  const pendingAction = pendingActions.get(actionId)!;

  if (pendingAction.status !== "awaiting_follow_up") {
    return { success: false, errorCode: "ACTION_NOT_ACTIVE" };
  }

  pendingAction.status = "completed";

  return { success: true, pendingAction: { ...pendingAction } };
}

export function resetPendingReturnActionsForTests(): void {
  pendingActions.clear();
  nextActionNumber = 1;
}
