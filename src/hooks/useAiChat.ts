"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/ai/chat-types";
import { postChatMessages, processAssistantReply } from "@/lib/ai/chat-api";
import type { MoleculeData } from "@/lib/molecules/types";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { toast } from "@/lib/toast";

export const WELCOME_MESSAGE_ID = "welcome";
export const AUTH_GATE_LOGIN_MESSAGE = "Sign in to generate 3D structures.";
export const AUTH_GATE_CREDITS_MESSAGE =
  "Insufficient credits. Please top up your balance.";
export const AUTH_GATE_VERIFY_MESSAGE =
  "Verify your email to unlock AI features and starter credits. Check your inbox for the link.";

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
  const { isAuthenticated, credits, user, openAuthModal, openBillingModal, fetchBalance } = useAuth();
  const { t } = useLanguage();

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

    if (!isAuthenticated) {
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: createMessageId(),
          role: "assistant",
          content: t.ai_gate_login ?? AUTH_GATE_LOGIN_MESSAGE,
        },
      ]);
      setInput("");
      toast.info(t.ai_gate_login ?? AUTH_GATE_LOGIN_MESSAGE);
      openAuthModal("login");
      return;
    }

    if (user && !user.isVerified) {
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: createMessageId(),
          role: "assistant",
          content: t.ai_gate_verify ?? AUTH_GATE_VERIFY_MESSAGE,
        },
      ]);
      setInput("");
      toast.info(t.ai_gate_verify ?? AUTH_GATE_VERIFY_MESSAGE);
      return;
    }

    if (credits !== null && credits <= 0) {
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: createMessageId(),
          role: "assistant",
          content: t.ai_gate_credits ?? AUTH_GATE_CREDITS_MESSAGE,
        },
      ]);
      setInput("");
      toast.error(t.ai_gate_credits ?? AUTH_GATE_CREDITS_MESSAGE);
      openBillingModal();
      return;
    }

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
        toast.success(t.toast_molecule_ready ?? "3D structure loaded in the viewer.");
      }

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: displayMessage,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (smiles || molecule) {
        await fetchBalance();
      }
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : (t.toast_request_failed ?? "Request could not be completed.");
      if (errMsg === "EMAIL_NOT_VERIFIED") {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: "assistant",
            content: t.ai_gate_verify ?? AUTH_GATE_VERIFY_MESSAGE,
          },
        ]);
      } else if (errMsg === "INSUFFICIENT_CREDITS" || errMsg.toLowerCase().includes("insufficient")) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: "assistant",
            content: t.ai_gate_credits ?? AUTH_GATE_CREDITS_MESSAGE,
          },
        ]);
        openBillingModal();
      }
      setError(errMsg);
      toast.error(
        errMsg === "EMAIL_NOT_VERIFIED"
          ? (t.ai_gate_verify ?? AUTH_GATE_VERIFY_MESSAGE)
          : errMsg === "INSUFFICIENT_CREDITS"
            ? (t.ai_gate_credits ?? AUTH_GATE_CREDITS_MESSAGE)
            : errMsg === "UNAUTHORIZED"
              ? (t.toast_session_expired ?? "Your session has expired. Please sign in again.")
              : errMsg,
      );
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    messages,
    onMoleculeGenerated,
    isAuthenticated,
    user,
    credits,
    openAuthModal,
    openBillingModal,
    fetchBalance,
    t.ai_gate_login,
    t.ai_gate_credits,
    t.ai_gate_verify,
    t.toast_molecule_ready,
    t.toast_request_failed,
    t.toast_session_expired,
  ]);

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
