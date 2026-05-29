"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

export type ChatMessageContentVariant = "assistant" | "user";

interface ChatMessageContentProps {
  content: string;
  variant?: ChatMessageContentVariant;
  isWhiteLab?: boolean;
  className?: string;
}

const assistantComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-indigo-500 underline underline-offset-2 hover:text-indigo-400 dark:text-indigo-300 dark:hover:text-indigo-200"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isFenced = Boolean(className?.startsWith("language-"));
    if (!isFenced) {
      return (
        <code
          className="rounded px-1 py-0.5 font-mono text-[0.85em] bg-black/10 dark:bg-white/10"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={cn("block font-mono text-[0.8em]", className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-[0.8em] dark:border-white/10 dark:bg-black/30">
      {children}
    </pre>
  ),
};

export function ChatMessageContent({
  content,
  variant = "assistant",
  isWhiteLab = false,
  className,
}: ChatMessageContentProps) {
  if (variant === "user") {
    return (
      <p className={cn("whitespace-pre-wrap break-words text-inherit", className)}>{content}</p>
    );
  }

  const themeClass = isWhiteLab ? "chat-markdown--light" : "chat-markdown--dark";

  return (
    <div className={cn("chat-markdown", themeClass, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={assistantComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
