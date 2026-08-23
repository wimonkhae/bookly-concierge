import { NextResponse } from "next/server";
import { respondToOrderStatusMessage } from "@/lib/agent/bookly-concierge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { sessionId?: unknown; message?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  if (typeof body.sessionId !== "string" || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  const result = await respondToOrderStatusMessage(body.sessionId, body.message.trim());
  const status = result.success ? 200 : result.errorCode === "OPENAI_API_KEY_MISSING" ? 503 : 401;

  return NextResponse.json(result, { status });
}
