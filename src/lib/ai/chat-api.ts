import type { ChatErrorBody, ChatMessage, ChatRequestBody, ChatResponseBody } from "./chat-types";
import { extractSmilesFromMessage, stripSmilesTags } from "./smiles";
import { fetchMoleculeFromSMILES } from "@/lib/molecules/sdf-parser";
import type { MoleculeData } from "@/lib/molecules/types";

export async function postChatMessages(
  messages: Pick<ChatMessage, "role" | "content">[],
): Promise<ChatResponseBody> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages } satisfies ChatRequestBody),
  });

  const data: unknown = await res.json();

  if (!res.ok) {
    const errMsg =
      data && typeof data === "object" && "error" in data && typeof (data as ChatErrorBody).error === "string"
        ? (data as ChatErrorBody).error
        : "Request failed.";
    throw new Error(errMsg);
  }

  return data as ChatResponseBody;
}

export interface ProcessedChatReply {
  displayMessage: string;
  smiles: string | null;
  molecule: MoleculeData | null;
}

/** Parse assistant reply, fetch 3D structure from SMILES when present. */
export async function processAssistantReply(rawMessage: string): Promise<ProcessedChatReply> {
  const smiles = extractSmilesFromMessage(rawMessage);
  const displayMessage = stripSmilesTags(rawMessage);

  if (!smiles) {
    return { displayMessage, smiles: null, molecule: null };
  }

  const molecule = await fetchMoleculeFromSMILES(smiles);
  return { displayMessage, smiles, molecule };
}
