export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface ChatRequestBody {
  messages: Pick<ChatMessage, "role" | "content">[];
}

export interface ChatResponseBody {
  message: string;
}

export interface ChatErrorBody {
  error: string;
}
