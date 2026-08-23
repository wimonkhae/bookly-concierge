import { NextResponse } from "next/server";
import { signInAsCustomer } from "@/lib/session/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { customerId?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  if (typeof body.customerId !== "string") {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  const result = signInAsCustomer(body.customerId);

  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
