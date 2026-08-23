import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
} from "openai/resources/responses/responses";
import {
  cancelPendingReturnAction,
  completeReturnFollowUp,
  getSingleAwaitingFollowUpAction,
  getSingleAwaitingPendingReturnAction,
} from "@/lib/guardrails/return-actions";
import { getAuthenticatedCustomer } from "@/lib/session/session";
import type { TraceEventType } from "@/lib/trace/trace";
import {
  checkReturnEligibility,
  confirmReturn,
  createReturn,
  getOrderDetails,
  getOrderStatus,
  getRefundStatus,
  getRecentOrders,
  lookupPolicy,
  prepareReturn,
  prepareReturns,
  escalateToHuman,
} from "@/lib/tools/bookly-tools";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5";
// A complex handoff may need three tools, followed by one final response turn.
const MAX_TOOL_ROUNDS = 4;

const BOOKLY_TOOLS: ResponseCreateParamsNonStreaming["tools"] = [
  {
    type: "function",
    name: "get_recent_orders",
    description: "Get the authenticated customer's recent Bookly orders. Use this first for requests about a latest or recent order.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "get_order_status",
    description: "Get authoritative shipping or fulfillment status for one Bookly order owned by the authenticated customer.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderId: { type: "string", description: "A Bookly order ID." } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_order_details",
    description: "Get the items and delivery details for one Bookly order owned by the authenticated customer.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderId: { type: "string", description: "A Bookly order ID." } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "check_return_eligibility",
    description: "Check the authoritative return eligibility, refund amount, and deadline for one order item.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        itemId: { type: "string" },
      },
      required: ["orderId", "itemId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_return",
    description: "Create a pending, non-executed return proposal after eligibility is confirmed and the customer has unambiguously selected one item. This does not create a return.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        itemId: { type: "string" },
        reason: { type: "string", description: "Use Customer requested return when no reason was supplied." },
      },
      required: ["orderId", "itemId", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "prepare_returns",
    description: "Create one pending, non-executed grouped return proposal for multiple eligible items from the same order. This does not create a return.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        itemIds: { type: "array", items: { type: "string" }, minItems: 2 },
        reason: { type: "string", description: "Use Customer requested return when no reason was supplied." },
      },
      required: ["orderId", "itemIds", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lookup_policy",
    description: "Look up an approved Bookly policy before answering a policy question.",
    strict: true,
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The customer's policy question." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_refund_status",
    description: "Get the authoritative Bookly refund status for one customer-owned order.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "escalate_to_human",
    description: "Create a human-support ticket when the issue cannot be verified, is outside the agent's authority, or needs manual investigation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        conversationSummary: { type: "string" },
      },
      required: ["reason", "conversationSummary"],
      additionalProperties: false,
    },
  },
];

const BOOKLY_INSTRUCTIONS = `You are Bookly Concierge, a concise customer support agent.
The customer is already authenticated. Never ask for their identity or a customer ID.
Use Bookly tools for all order, shipping, and return facts. Never invent transactional facts.
For a latest-order status question, call get_recent_orders first, then get_order_status for the most recent active order.
For a return request about the customer's last order, call get_recent_orders then get_order_details for the most recent delivered order. If it contains more than one eligible item and the customer has not selected one, list those items and ask whether they want to return one title or all eligible titles together. Do not guess.
After the customer identifies one item, call check_return_eligibility. If eligible, call prepare_return, explain the refund amount and deadline from the tool output, and ask for explicit confirmation. If the customer chooses multiple eligible titles from the same order, call prepare_returns with all item IDs, explain the combined refund amount and deadline, and ask for one explicit confirmation. Neither tool creates a return.
For Bookly policy questions, call lookup_policy and answer only from the returned policy. For refund disputes, retrieve the available refund status. If Bookly cannot verify the requested outcome, call escalate_to_human with a concise reason and summary; tell the customer the handoff includes the context already gathered.
Explicit confirmation and return execution are enforced by the Bookly application, not by you. Never claim a return succeeded unless Bookly has already returned an action result. When you resolve an issue, ask whether there is anything else you can help with; do not do this while you need clarification or confirmation. In customer-facing text, use only the single reference that helps the customer: an order ID for an order or refund question, or a return reference after creating a return. Never include internal item IDs, multiple references, or tracking codes unless the customer specifically asks for them.`;

type CreateResponse = (request: ResponseCreateParamsNonStreaming) => Promise<Response>;

export type BooklyAgentResult =
  | { success: true; text: string; responseId?: string }
  | { success: false; errorCode: "UNAUTHENTICATED" | "OPENAI_API_KEY_MISSING" | "TOOL_LOOP_EXCEEDED" | "RETURN_EXECUTION_FAILED" };

export type BooklyAgentOptions = {
  model?: string;
  previousResponseId?: string;
  createResponse?: CreateResponse;
  onTraceEvent?: (type: TraceEventType, detail: string) => void;
};

function createOpenAIResponse(): CreateResponse {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY_MISSING");
  }

  const client = new OpenAI({ apiKey });

  return (request) => client.responses.create(request);
}

function getFunctionCalls(response: Response): ResponseFunctionToolCall[] {
  return response.output.filter(
    (item): item is ResponseFunctionToolCall => item.type === "function_call",
  );
}

function getArguments(argumentsJson: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function getStringArrayArgument(argumentsJson: string, key: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (typeof parsed !== "object" || parsed === null || !(key in parsed)) {
      return undefined;
    }

    const value = (parsed as Record<string, unknown>)[key];
    return Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : undefined;
  } catch {
    return undefined;
  }
}

function executeBooklyTool(sessionId: string, call: ResponseFunctionToolCall) {
  const args = getArguments(call.arguments);

  switch (call.name) {
    case "get_recent_orders":
      return getRecentOrders(sessionId);
    case "get_order_status":
      return args.orderId
        ? getOrderStatus(sessionId, args.orderId)
        : { success: false as const, errorCode: "INVALID_ORDER_ID" };
    case "get_order_details":
      return args.orderId
        ? getOrderDetails(sessionId, args.orderId)
        : { success: false as const, errorCode: "INVALID_ORDER_ID" };
    case "check_return_eligibility":
      return args.orderId && args.itemId
        ? checkReturnEligibility(sessionId, args.orderId, args.itemId)
        : { success: false as const, errorCode: "INVALID_RETURN_ITEM" };
    case "prepare_return":
      return args.orderId && args.itemId && args.reason
        ? prepareReturn(sessionId, args.orderId, args.itemId, args.reason)
        : { success: false as const, errorCode: "INVALID_RETURN_ITEM" };
    case "prepare_returns": {
      const itemIds = getStringArrayArgument(call.arguments, "itemIds");
      return args.orderId && args.reason && itemIds
        ? prepareReturns(sessionId, args.orderId, itemIds, args.reason)
        : { success: false as const, errorCode: "INVALID_RETURN_ITEM" };
    }
    case "lookup_policy":
      return args.query
        ? lookupPolicy(args.query)
        : { success: false as const, errorCode: "INVALID_POLICY_QUERY" };
    case "get_refund_status":
      return args.orderId
        ? getRefundStatus(sessionId, args.orderId)
        : { success: false as const, errorCode: "INVALID_ORDER_ID" };
    case "escalate_to_human":
      return args.reason && args.conversationSummary
        ? escalateToHuman(sessionId, args.reason, args.conversationSummary)
        : { success: false as const, errorCode: "INVALID_ESCALATION" };
    default:
      return { success: false as const, errorCode: "TOOL_NOT_AVAILABLE" };
  }
}

function responseRequest(
  model: string,
  input: ResponseCreateParamsNonStreaming["input"],
  previousResponseId?: string,
): ResponseCreateParamsNonStreaming {
  return {
    model,
    instructions: BOOKLY_INSTRUCTIONS,
    input,
    tools: BOOKLY_TOOLS,
    tool_choice: previousResponseId ? "auto" : "required",
    parallel_tool_calls: false,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  };
}

function describeResponse(response: Response): string {
  const toolCalls = getFunctionCalls(response);

  return toolCalls.length
    ? `response=${response.id}; requested ${toolCalls.map((call) => call.name).join(", ")}`
    : `response=${response.id}; returned customer-facing text`;
}

function isLatestOrderStatusQuestion(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

  return /where (is|s) (my )?(latest |last )?order/.test(normalized)
    || /where (is|s) my order/.test(normalized)
    || /track (my )?order/.test(normalized);
}

function resolveLatestOrderStatus(
  sessionId: string,
  message: string,
  onTraceEvent?: BooklyAgentOptions["onTraceEvent"],
): BooklyAgentResult | undefined {
  if (!isLatestOrderStatusQuestion(message)) {
    return undefined;
  }

  onTraceEvent?.("FAST_PATH", "High-confidence latest-order workflow; skipped model orchestration.");
  onTraceEvent?.("TOOL_CALL", "get_recent_orders");
  const recentOrders = getRecentOrders(sessionId);
  onTraceEvent?.("TOOL_RESULT", JSON.stringify(recentOrders));

  if (!recentOrders.success) {
    return undefined;
  }

  const latestOrder = recentOrders.orders.find((order) => order.status === "processing" || order.status === "shipped")
    ?? recentOrders.orders[0];

  if (!latestOrder) {
    return { success: true, text: "I couldn't find a recent order on your Bookly account. Is there anything else I can help with today?" };
  }

  onTraceEvent?.("TOOL_CALL", "get_order_status");
  const orderStatus = getOrderStatus(sessionId, latestOrder.orderId);
  onTraceEvent?.("TOOL_RESULT", JSON.stringify(orderStatus));

  if (!orderStatus.success) {
    return undefined;
  }

  const delivery = orderStatus.expectedDelivery ? ` It is expected on ${orderStatus.expectedDelivery}.` : "";
  const tracking = orderStatus.trackingNumber ? ` Tracking: ${orderStatus.trackingNumber}.` : "";
  const carrier = orderStatus.carrier ? ` with ${orderStatus.carrier}` : "";
  const text = orderStatus.status === "shipped"
    ? `Your latest order (${orderStatus.orderId}) has shipped and is in transit${carrier}.${tracking}${delivery} Is there anything else I can help with today?`
    : `Your latest order (${orderStatus.orderId}) is currently ${orderStatus.status}.${delivery} Is there anything else I can help with today?`;

  onTraceEvent?.("ASSISTANT_RESPONSE", text);
  return { success: true, text };
}

function normalizeConfirmation(message: string): string {
  return message.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function isAffirmativeConfirmation(message: string): boolean {
  return ["yes", "yes please", "please do", "go ahead", "do it", "confirm", "start the return"].includes(
    normalizeConfirmation(message),
  );
}

function isNegativeConfirmation(message: string): boolean {
  return ["no", "no thanks", "no thats all", "thats all", "cancel", "do not", "dont"].includes(
    normalizeConfirmation(message),
  );
}

function resolvePendingReturnDecision(
  customerId: string,
  sessionId: string,
  message: string,
  onTraceEvent?: BooklyAgentOptions["onTraceEvent"],
): BooklyAgentResult | undefined {
  const pendingAction = getSingleAwaitingPendingReturnAction(customerId);

  if (!pendingAction) {
    return undefined;
  }

  if (isNegativeConfirmation(message)) {
    const cancelled = cancelPendingReturnAction(customerId, pendingAction.actionId);

    onTraceEvent?.("CONFIRMATION", "Customer declined the pending return.");
    const isConversationClose = ["no thanks", "no thats all", "thats all"].includes(
      normalizeConfirmation(message),
    );
    return cancelled.success
      ? {
          success: true,
          text: isConversationClose
            ? "You're all set. Thanks for contacting Bookly, and have a lovely day!"
            : "No problem. I won't start the return.",
        }
      : { success: false, errorCode: "RETURN_EXECUTION_FAILED" };
  }

  if (!isAffirmativeConfirmation(message)) {
    return undefined;
  }

  onTraceEvent?.("CONFIRMATION", `Customer confirmed ${pendingAction.actionId}.`);
  const confirmation = confirmReturn(sessionId, pendingAction.actionId);

  if (!confirmation.success) {
    return { success: false, errorCode: "RETURN_EXECUTION_FAILED" };
  }

  const createdReturn = createReturn(sessionId, pendingAction.actionId);

  if (createdReturn.success) {
    onTraceEvent?.("ACTION_EXECUTED", `Created return ${createdReturn.returnRecord.returnId}.`);
  }
  return createdReturn.success
    ? {
        success: true,
        text: `Done. Your return reference is ${createdReturn.returnRecord.returnId}. Is there anything else I can help with today?`,
      }
    : { success: false, errorCode: "RETURN_EXECUTION_FAILED" };
}

function resolveReturnFollowUp(
  customerId: string,
  message: string,
  onTraceEvent?: BooklyAgentOptions["onTraceEvent"],
): BooklyAgentResult | undefined {
  const followUpAction = getSingleAwaitingFollowUpAction(customerId);

  if (!followUpAction) {
    return undefined;
  }

  completeReturnFollowUp(customerId, followUpAction.actionId);

  if (!isNegativeConfirmation(message)) {
    return undefined;
  }

  const text = "You're all set. Thanks for contacting Bookly, and have a lovely day!";
  onTraceEvent?.("ASSISTANT_RESPONSE", text);
  return { success: true, text };
}

export async function respondToBooklyMessage(
  sessionId: string,
  message: string,
  options: BooklyAgentOptions = {},
): Promise<BooklyAgentResult> {
  const customer = getAuthenticatedCustomer(sessionId);

  if (!customer) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }

  options.onTraceEvent?.("USER_MESSAGE", message);
  const latestOrderStatus = resolveLatestOrderStatus(sessionId, message, options.onTraceEvent);

  if (latestOrderStatus) {
    return latestOrderStatus;
  }
  const returnFollowUp = resolveReturnFollowUp(customer.customerId, message, options.onTraceEvent);

  if (returnFollowUp) {
    return returnFollowUp;
  }
  const pendingReturnDecision = resolvePendingReturnDecision(
    customer.customerId,
    sessionId,
    message,
    options.onTraceEvent,
  );

  if (pendingReturnDecision) {
    if (pendingReturnDecision.success) {
      options.onTraceEvent?.("ASSISTANT_RESPONSE", pendingReturnDecision.text);
    }
    return pendingReturnDecision;
  }

  let createResponse: CreateResponse;

  try {
    createResponse = options.createResponse ?? createOpenAIResponse();
  } catch {
    return { success: false, errorCode: "OPENAI_API_KEY_MISSING" };
  }

  const model = options.model ?? DEFAULT_MODEL;
  const initialRequest = responseRequest(model, message, options.previousResponseId);
  options.onTraceEvent?.(
    "RESPONSES_API_REQUEST",
    `model=${model}; tool_choice=${initialRequest.tool_choice}`,
  );
  let response = await createResponse(initialRequest);
  options.onTraceEvent?.("RESPONSES_API_RESPONSE", describeResponse(response));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const toolCalls = getFunctionCalls(response);

    if (toolCalls.length === 0) {
      if (response.output_text.includes("Which one")) {
        options.onTraceEvent?.("CLARIFICATION", "Asked the customer to select a specific order item.");
      }
      options.onTraceEvent?.("ASSISTANT_RESPONSE", response.output_text);
      return { success: true, text: response.output_text, responseId: response.id };
    }

    const followUpRequest = responseRequest(
      model,
      toolCalls.map((call) => {
        options.onTraceEvent?.("TOOL_CALL", call.name);
        const output = executeBooklyTool(sessionId, call);
        const serializedOutput = JSON.stringify(output);

        options.onTraceEvent?.("TOOL_RESULT", serializedOutput);
        if (call.name === "prepare_return" && output.success) {
          options.onTraceEvent?.("PENDING_ACTION", "Return proposal is awaiting confirmation.");
        }
        if (call.name === "escalate_to_human" && output.success) {
          options.onTraceEvent?.("ESCALATION", "Created a human-support ticket.");
        }

        return {
          type: "function_call_output" as const,
          call_id: call.call_id,
          output: serializedOutput,
        };
      }),
      response.id,
    );
    options.onTraceEvent?.(
      "RESPONSES_API_REQUEST",
      `model=${model}; submitting ${toolCalls.length} tool result${toolCalls.length === 1 ? "" : "s"}`,
    );
    response = await createResponse(followUpRequest);
    options.onTraceEvent?.("RESPONSES_API_RESPONSE", describeResponse(response));
  }

  return { success: false, errorCode: "TOOL_LOOP_EXCEEDED" };
}

export const respondToOrderStatusMessage = respondToBooklyMessage;
