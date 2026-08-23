import { afterEach, describe, expect, test } from "vitest";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { respondToBooklyMessage, respondToOrderStatusMessage } from "@/lib/agent/bookly-concierge";
import { resetPendingReturnActionsForTests } from "@/lib/guardrails/return-actions";
import { resetMockSessionsForTests, signInAsCustomer } from "@/lib/session/session";
import { createReturn, getRefundStatus, prepareReturn, resetMockToolStateForTests } from "@/lib/tools/bookly-tools";

afterEach(() => {
  resetMockSessionsForTests();
  resetMockToolStateForTests();
  resetPendingReturnActionsForTests();
});

function response(input: Partial<Response>): Response {
  return input as Response;
}

function signInSarah(): string {
  const result = signInAsCustomer("CUST-001");

  if (!result.success) {
    throw new Error("Sarah must be able to sign in.");
  }

  return result.session.sessionId;
}

describe("Bookly Concierge order-status agent", () => {
  test("uses a deterministic fast path for a high-confidence latest-order question", async () => {
    const result = await respondToOrderStatusMessage(
      signInSarah(),
      "Where's my latest order?",
      {
        createResponse: async () => {
          throw new Error("The fast path should not call OpenAI.");
        },
      },
    );

    expect(result).toMatchObject({
      success: true,
      text: expect.stringContaining("ORD-1048"),
    });
  });

  test("rejects an unknown session before calling OpenAI", async () => {
    const createResponse = async () => {
      throw new Error("OpenAI should not be called.");
    };

    await expect(
      respondToOrderStatusMessage("unknown-session", "Where's my latest order?", { createResponse }),
    ).resolves.toEqual({ success: false, errorCode: "UNAUTHENTICATED" });
  });

  test("clarifies an ambiguous return, then retains context to prepare a return", async () => {
    const requests: ResponseCreateParamsNonStreaming[] = [];
    const responses = [
      response({
        id: "resp-return-1",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-return-orders",
            name: "get_recent_orders",
            arguments: "{}",
          },
        ],
      }),
      response({
        id: "resp-return-2",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-return-details",
            name: "get_order_details",
            arguments: '{"orderId":"ORD-1031"}',
          },
        ],
      }),
      response({
        id: "resp-return-3",
        output_text: "Sure. Your last order contained Wolf Hall and The Midnight Library. Which one would you like to return?",
        output: [],
      }),
      response({
        id: "resp-return-4",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-eligibility",
            name: "check_return_eligibility",
            arguments: '{"orderId":"ORD-1031","itemId":"ITEM-WOLF-01"}',
          },
        ],
      }),
      response({
        id: "resp-return-5",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-prepare-return",
            name: "prepare_return",
            arguments: '{"orderId":"ORD-1031","itemId":"ITEM-WOLF-01","reason":"Customer requested return"}',
          },
        ],
      }),
      response({
        id: "resp-return-6",
        output_text: "Wolf Hall is eligible for return until 12 September. The expected refund is £18.99. Would you like me to start the return?",
        output: [],
      }),
    ];
    const createResponse = async (request: ResponseCreateParamsNonStreaming) => {
      requests.push(request);
      return responses.shift()!;
    };
    const sessionId = signInSarah();

    const clarification = await respondToBooklyMessage(
      sessionId,
      "I need to return one of the books from my last order.",
      { createResponse },
    );

    expect(clarification).toMatchObject({
      success: true,
      responseId: "resp-return-3",
      text: expect.stringContaining("Which one"),
    });
    expect(requests).toHaveLength(3);

    const eligibility = await respondToBooklyMessage(sessionId, "Wolf Hall.", {
      previousResponseId: "resp-return-3",
      createResponse,
    });

    expect(eligibility).toMatchObject({
      success: true,
      responseId: "resp-return-6",
      text: expect.stringContaining("Would you like me to start the return?"),
    });
    expect(requests[3]).toMatchObject({
      previous_response_id: "resp-return-3",
      input: "Wolf Hall.",
    });
    expect(requests[5]).toMatchObject({
      input: [
        {
          type: "function_call_output",
          call_id: "call-prepare-return",
          output: expect.stringContaining('"status":"awaiting_confirmation"'),
        },
      ],
    });
  });

  test("executes a pending return for an explicit confirmation without calling OpenAI", async () => {
    const sessionId = signInSarah();
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "Customer requested return");

    if (!proposal.success) {
      throw new Error("Expected an eligible pending return.");
    }

    const result = await respondToBooklyMessage(sessionId, "Yes.", {
      createResponse: async () => {
        throw new Error("A deterministic confirmation must not call OpenAI.");
      },
    });

    expect(result).toEqual({
      success: true,
      text: "Done. Your return reference: RMA-1842. Is there anything else I can help with today?",
    });
    await expect(
      respondToBooklyMessage(sessionId, "No, that's all.", {
        createResponse: async () => {
          throw new Error("A deterministic follow-up should not call OpenAI.");
        },
      }),
    ).resolves.toEqual({
      success: true,
      text: "You're all set. Thanks for contacting Bookly, and have a lovely day!",
    });
    expect(getRefundStatus(sessionId, "ORD-1031")).toMatchObject({
      success: true,
      refund: { returnId: "RMA-1842", status: "registered" },
    });
  });

  test("does not execute a return for no, maybe later, or a change of subject", async () => {
    const sessionId = signInSarah();
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "Customer requested return");

    if (!proposal.success) {
      throw new Error("Expected an eligible pending return.");
    }

    const modelText = async () => response({ id: "resp-no", output_text: "Understood.", output: [] });

    await expect(respondToBooklyMessage(sessionId, "Maybe later.", { createResponse: modelText })).resolves.toMatchObject({
      success: true,
      text: "Understood.",
    });
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_REQUIRES_CONFIRMATION",
    });

    await expect(respondToBooklyMessage(sessionId, "What time do you close?", { createResponse: modelText })).resolves.toMatchObject({
      success: true,
      text: "Understood.",
    });
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_REQUIRES_CONFIRMATION",
    });

    await expect(respondToBooklyMessage(sessionId, "No.", { createResponse: modelText })).resolves.toEqual({
      success: true,
      text: "No problem. I won't start the return.",
    });
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_NOT_ACTIVE",
    });
  });

  test("closes politely when no thanks declines a pending return", async () => {
    const sessionId = signInSarah();
    const proposal = prepareReturn(sessionId, "ORD-1031", "ITEM-WOLF-01", "Customer requested return");

    if (!proposal.success) {
      throw new Error("Expected an eligible pending return.");
    }

    await expect(respondToBooklyMessage(sessionId, "No, thanks.")).resolves.toEqual({
      success: true,
      text: "You're all set. Thanks for contacting Bookly, and have a lovely day!",
    });
    expect(createReturn(sessionId, proposal.pendingAction.actionId)).toEqual({
      success: false,
      errorCode: "ACTION_NOT_ACTIVE",
    });
  });

  test("does not execute an unrelated yes when no return is pending", async () => {
    const result = await respondToBooklyMessage(signInSarah(), "Yes.", {
      createResponse: async () => response({ id: "resp-no-pending", output_text: "How can I help?", output: [] }),
    });

    expect(result).toEqual({ success: true, text: "How can I help?", responseId: "resp-no-pending" });
  });

  test("grounds a policy answer in Bookly policy data", async () => {
    const requests: ResponseCreateParamsNonStreaming[] = [];
    const responses = [
      response({
        id: "resp-policy-1",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-policy",
            name: "lookup_policy",
            arguments: '{"query":"How long do refunds take?"}',
          },
        ],
      }),
      response({
        id: "resp-policy-2",
        output_text: "Refunds go to the original payment method within 3 to 5 business days after Bookly receives the item.",
        output: [],
      }),
    ];

    const result = await respondToBooklyMessage(signInSarah(), "How long do refunds take?", {
      createResponse: async (request) => {
        requests.push(request);
        return responses.shift()!;
      },
    });

    expect(result).toMatchObject({ success: true, text: expect.stringContaining("3 to 5 business days") });
    expect(requests[1]).toMatchObject({
      input: [
        {
          type: "function_call_output",
          call_id: "call-policy",
          output: expect.stringContaining("POL-REFUNDS"),
        },
      ],
    });
  });

  test("escalates an unverified refund dispute with a contextual ticket", async () => {
    const responses = [
      response({
        id: "resp-refund-1",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-refund-status",
            name: "get_refund_status",
            arguments: '{"orderId":"ORD-1031"}',
          },
        ],
      }),
      response({
        id: "resp-refund-2",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call-escalate",
            name: "escalate_to_human",
            arguments: '{"reason":"unverified_return","conversationSummary":"Customer reports a returned book but Bookly cannot verify a refund."}',
          },
        ],
      }),
      response({
        id: "resp-refund-3",
        output_text: "I can't verify that refund from the available information, so I've passed this to support with the details we've discussed.",
        output: [],
      }),
    ];

    const result = await respondToBooklyMessage(signInSarah(), "I returned another book three weeks ago and still have no refund.", {
      createResponse: async () => responses.shift()!,
    });

    expect(result).toMatchObject({ success: true, text: expect.stringContaining("passed this to support") });
  });
});
