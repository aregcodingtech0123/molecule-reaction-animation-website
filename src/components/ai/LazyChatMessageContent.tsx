"use client";

import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessageContentVariant } from "@/components/ai/ChatMessageContent";

/**
 * Chat message rendering without the markdown stack in the shared bundle (PERF-24).
 *
 * The assistant chat is mounted on every page (root providers), and its renderer (react-markdown and
 * rehype-sanitize; KaTeX until R15 removed it) was ~129 KiB of compressed JavaScript in every route's initial
 * load, needed only once a chat has an assistant answer. That renderer (ChatMessageContent, unchanged and still
 * the only place assistant output is turned into HTML) now loads on demand: AiChatPanel prefetches it when a
 * panel mounts, and until it has loaded an answer shows as plain text (React-escaped, never parsed).
 */
const loadRenderer = () => import("@/components/ai/ChatMessageContent");

const MarkdownRenderer = lazy(() => loadRenderer().then((m) => ({ default: m.ChatMessageContent })));

/** Starts fetching the renderer (idempotent: the module loader caches the request). */
export function preloadChatRenderer(): void {
  void loadRenderer();
}

interface LazyChatMessageContentProps {
  content: string;
  variant?: ChatMessageContentVariant;
  isWhiteLab?: boolean;
  className?: string;
  /**
   * Render as escaped plain text and never swap to the markdown renderer (R10). Only for text that is a constant of
   * this app (the built-in welcome message), never for model output: the swap re-paints the paragraph once the
   * markdown chunk arrives, which made that paragraph's LCP wait for the chunk on the AI Lab page.
   */
  plain?: boolean;
}

function PlainText({ content, className }: { content: string; className?: string }) {
  return <p className={cn("whitespace-pre-wrap break-words text-inherit", className)}>{content}</p>;
}

export function LazyChatMessageContent({ content, variant = "assistant", isWhiteLab = false, className, plain = false }: LazyChatMessageContentProps) {
  // User messages are plain text in either renderer: no reason to wait for the markdown stack.
  if (variant === "user" || plain) return <PlainText content={content} className={className} />;
  return (
    <Suspense fallback={<PlainText content={content} className={className} />}>
      <MarkdownRenderer content={content} variant="assistant" isWhiteLab={isWhiteLab} className={className} />
    </Suspense>
  );
}
