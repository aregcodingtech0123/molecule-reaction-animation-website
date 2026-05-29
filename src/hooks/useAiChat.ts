"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/ai/chat-types";
import { postChatMessages, processAssistantReply } from "@/lib/ai/chat-api";
import type { MoleculeData } from "@/lib/molecules/types";

export const WELCOME_MESSAGE_ID = "welcome";

export const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  id: WELCOME_MESSAGE_ID,
  role: "assistant",
  content:
    "Hi! I'm your MoleculeStudio Lab Assistant. Ask me about molecules, chemical properties, biological effects, reactions, or material science — in any language you prefer.",
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface UseAiChatOptions {
  welcomeMessage?: ChatMessage;
  /** Called when Gemini returns a SMILES block and 3D coords are resolved */
  onMoleculeGenerated?: (molecule: MoleculeData, smiles: string) => void;
  /** Auto-scroll when messages change */
  autoScroll?: boolean;
}

export function useAiChat(options: UseAiChatOptions = {}) {
  const {
    welcomeMessage = DEFAULT_WELCOME_MESSAGE,
    onMoleculeGenerated,
    autoScroll = true,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [messages, loading, autoScroll, scrollToBottom]);

  const resetChat = useCallback(() => {
    setMessages([welcomeMessage]);
    setInput("");
    setError(null);
    setLoading(false);
  }, [welcomeMessage]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { id: createMessageId(), role: "user", content: text };
    const historyForApi = [...messages, userMessage]
      .filter((m) => m.id !== WELCOME_MESSAGE_ID)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const reply = await postChatMessages(historyForApi);
      const { displayMessage, smiles, molecule } = await processAssistantReply(reply.message);

      if (molecule && smiles && onMoleculeGenerated) {
        onMoleculeGenerated(molecule, smiles);
      }

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: displayMessage,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Something went wrong.";
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, onMoleculeGenerated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage],
  );

  return {
    messages,
    input,
    setInput,
    loading,
    error,
    sendMessage,
    resetChat,
    scrollRef,
    inputRef,
    handleKeyDown,
    setError,
  };
}

export type UseAiChatReturn = ReturnType<typeof useAiChat>;
