import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ success: false, errorCode: "OPENAI_API_KEY_MISSING" }, { status: 503 });
  }

  const body = await request.json();

  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ success: false, errorCode: "INVALID_REQUEST" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const speech = await client.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: body.text.slice(0, 4096),
  });

  return new NextResponse(await speech.arrayBuffer(), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
