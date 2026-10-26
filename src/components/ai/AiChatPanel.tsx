"use client";

import { useEffect } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import type { ChatMessage } from "@/lib/ai/chat-types";
import type { UseAiChatReturn } from "@/hooks/useAiChat";
import { useTheme } from "@/context/ThemeContext";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { LazyChatMessageContent, preloadChatRenderer } from "@/components/ai/LazyChatMessageContent";

export type AiChatPanelVariant = "compact" | "embedded" | "full";

interface AiChatPanelProps {
  chat: Pick<
    UseAiChatReturn,
    | "messages"
    | "input"
    | "setInput"
    | "loading"
    | "error"
    | "sendMessage"
    | "scrollRef"
    | "inputRef"
    | "handleKeyDown"
  >;
  variant?: AiChatPanelVariant;
  className?: string;
  placeholder?: string;
  showFooterHint?: boolean;
  header?: React.ReactNode;
}

export function AiChatPanel({
  chat,
  variant = "embedded",
  className,
  placeholder,
  showFooterHint = true,
  header,
}: AiChatPanelProps) {
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();
  // The markdown renderer is a separate chunk (PERF-24): fetch it as soon as a chat panel exists.
  useEffect(() => preloadChatRenderer(), []);
  const {
    messages,
    input,
    setInput,
    loading,
    error,
    sendMessage,
    scrollRef,
    inputRef,
    handleKeyDown,
  } = chat;

  const scrollClass =
    variant === "full"
      ? "flex-1 min-h-0"
      : variant === "compact"
        ? "min-h-[12rem] max-h-[20rem]"
        : "min-h-[16rem] max-h-[28rem]";

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {header}

      <div
        ref={scrollRef}
        className={cn("overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin", scrollClass)}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isWhiteLab={isWhiteLab} ui={ui} />
        ))}
        {loading && (
          <div className="flex items-start gap-2">
            <div
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg",
                isWhiteLab ? "bg-indigo-100" : "bg-indigo-500/15",
              )}
            >
              <Bot className={cn("h-3.5 w-3.5", isWhiteLab ? "text-indigo-700" : "text-indigo-300")} />
            </div>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-2xl rounded-tl-md px-3 py-2.5 border",
                isWhiteLab ? "bg-slate-100 border-slate-200" : "bg-white/5 border-white/8",
              )}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
              <span className={cn("text-xs", ui.typography.muted)}>
                {t.ai_thinking ?? "Thinking…"}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}

      <footer className={cn("border-t p-3 flex-shrink-0", ui.borders.divider)}>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? t.ai_chat_placeholder ?? "Ask about a molecule…"}
            rows={variant === "full" ? 2 : 1}
            disabled={loading}
            className={cn(
              "flex-1 resize-none rounded-xl border px-3 py-2.5 text-sm",
              "focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/30",
              "disabled:opacity-50",
              variant === "full" ? "max-h-32" : "max-h-24",
              isWhiteLab
                ? "border-slate-300 bg-white text-neutral-900 placeholder:text-neutral-500"
                : "border-white/10 bg-black/40 text-white placeholder:text-gray-600",
            )}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            className={cn(
              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl",
              "bg-indigo-600 text-white transition-all",
              "hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed",
              isWhiteLab ? "shadow-sm" : "shadow-[0_0_20px_rgba(99,102,241,0.35)]",
            )}
            aria-label="Send message"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        {showFooterHint && (
          <p className={cn("mt-2 text-[10px] text-center", ui.typography.muted)}>
            {t.ai_footer_hint ?? "Science & molecules only · Replies match your language"}
          </p>
        )}
      </footer>
    </div>
  );
}

function MessageBubble({
  message,
  isWhiteLab,
  ui,
}: {
  message: ChatMessage;
  isWhiteLab: boolean;
  ui: ReturnType<typeof useTheme>["ui"];
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && (
        <div
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg mt-0.5",
            isWhiteLab ? "bg-indigo-100" : "bg-indigo-500/15",
          )}
        >
          <Bot className={cn("h-3.5 w-3.5", isWhiteLab ? "text-indigo-700" : "text-indigo-300")} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-md bg-indigo-600/90 text-white"
            : cn(
                "rounded-tl-md border",
                isWhiteLab
                  ? "bg-slate-100 border-slate-200"
                  : "bg-white/5 border-white/8",
                ui.typography.body,
              ),
        )}
      >
        <LazyChatMessageContent
          content={message.content}
          variant={isUser ? "user" : "assistant"}
          isWhiteLab={isWhiteLab}
        />
      </div>
    </div>
  );
}
