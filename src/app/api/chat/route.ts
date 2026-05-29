import { GoogleGenAI } from "@google/genai";
import {
  DEFAULT_GEMINI_MODEL,
  LAB_ASSISTANT_SYSTEM_INSTRUCTION,
} from "@/lib/ai/lab-assistant-prompt";
import type { ChatRequestBody } from "@/lib/ai/chat-types";

const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 8_000;

function isValidMessage(
  item: unknown,
): item is { role: "user" | "assistant"; content: string } {
  if (!item || typeof item !== "object") return false;
  const m = item as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0 &&
    m.content.length <= MAX_CONTENT_LENGTH
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Gemini API key is not configured on the server." },
      { status: 503 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "At least one message is required." }, { status: 400 });
  }

  const messages = body.messages.slice(-MAX_MESSAGES);
  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format in history." }, { status: 400 });
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    return Response.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content.trim() }],
  }));

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: LAB_ASSISTANT_SYSTEM_INSTRUCTION,
        temperature: 0.7,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return Response.json({ error: "The model returned an empty response." }, { status: 502 });
    }

    return Response.json({ message: text });
  } catch (err) {
    console.error("[api/chat]", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate a response.";
    return Response.json({ error: message }, { status: 500 });
  }
}
