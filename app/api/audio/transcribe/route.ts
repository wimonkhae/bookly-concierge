import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ success: false, errorCode: "OPENAI_API_KEY_MISSING" }, { status: 503 });
  }

  const formData = await request.formData();
  const audio = formData.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json({ success: false, errorCode: "INVALID_AUDIO" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await client.audio.transcriptions.create({
    file: audio,
    model: "gpt-4o-mini-transcribe",
  });

  return NextResponse.json({ success: true, text: transcription.text });
}
