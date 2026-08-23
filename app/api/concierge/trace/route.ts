import { NextResponse } from "next/server";
import { getTrace } from "@/lib/trace/trace";

export const runtime = "nodejs";

export function GET(request: Request) {
  const traceId = new URL(request.url).searchParams.get("traceId");

  if (!traceId) {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  const trace = getTrace(traceId);

  return trace
    ? NextResponse.json({ success: true, trace })
    : NextResponse.json({ success: false, errorCode: "TRACE_NOT_FOUND" }, { status: 404 });
}
