import { NextResponse } from "next/server";
import { respondToBooklyMessage } from "@/lib/agent/bookly-concierge";
import { createTrace, recordTraceEvent } from "@/lib/trace/trace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { sessionId?: unknown; message?: unknown; previousResponseId?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  if (
    typeof body.sessionId !== "string" ||
    typeof body.message !== "string" ||
    !body.message.trim() ||
    (body.previousResponseId !== undefined && typeof body.previousResponseId !== "string")
  ) {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  const trace = createTrace(body.sessionId, "chat");
  let result;

  try {
    result = await respondToBooklyMessage(body.sessionId, body.message.trim(), {
      previousResponseId: body.previousResponseId,
      onTraceEvent: (type, detail) => {
        recordTraceEvent(trace.traceId, type, detail);
        const label = type === "USER_MESSAGE" ? "CUSTOMER" : type === "ASSISTANT_RESPONSE" ? "BOOKLY" : type;
        console.info(`[Bookly Concierge][${trace.traceId}] ${label}: ${detail}`);
      },
    });
  } catch (error) {
    // Keep provider details in server logs; customers get a controlled failure.
    console.error("Bookly Concierge agent request failed.", error);
    return NextResponse.json(
      { success: false, errorCode: "AGENT_UNAVAILABLE", traceId: trace.traceId },
      { status: 502 },
    );
  }
  const status = result.success ? 200 : result.errorCode === "OPENAI_API_KEY_MISSING" ? 503 : 401;

  return NextResponse.json({ ...result, traceId: trace.traceId }, { status });
}
