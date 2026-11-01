/**
 * PERF-24: the chat's markdown / KaTeX renderer loads on demand. Until it has loaded an assistant answer is
 * plain, React-escaped text; once loaded, the same renderer as before (and its sanitisation, SEC-15) applies.
 * The renderer itself stays covered by chat-output-rendering.test.tsx.
 *
 * Order matters: the first test runs before anything has imported the renderer, so it sees the fallback.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { LazyChatMessageContent, preloadChatRenderer } from "@/components/ai/LazyChatMessageContent";

describe("LazyChatMessageContent", () => {
  it("before the renderer has loaded, an answer is escaped plain text — never parsed as HTML or markdown", { timeout: 20_000 }, async () => {
    const { container } = render(<LazyChatMessageContent content={"<b>x</b> **y**"} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("<b>x</b> **y**");
    // …and the same answer is rendered as markdown once the module has arrived (a cold import of the markdown
    // stack under the test transformer takes a few seconds).
    expect((await screen.findByText("y", {}, { timeout: 15_000 })).tagName).toBe("STRONG");
  });

  it("user messages are plain text immediately, never parsed", () => {
    const { container } = render(<LazyChatMessageContent variant="user" content={'<img src=x onerror="window.__pwned=1"> **bold**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="window.__pwned=1"> **bold**');
  });

  it("an assistant answer renders through the markdown renderer once it has loaded", async () => {
    preloadChatRenderer();
    const { container } = render(<LazyChatMessageContent content={"**Benzene** is `C6H6`."} />);
    expect(await screen.findByText("Benzene")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("Benzene");
    expect(container.querySelector("code")?.textContent).toBe("C6H6");
  });

  it("the loaded renderer still sanitises: a model-named image is never loaded, javascript: links are dropped", async () => {
    const { container } = render(
      <LazyChatMessageContent content={"Ring ![x](https://upload.example/b.png) and [click](javascript:alert(1)) done"} />,
    );
    await screen.findByText(/\[image: x\]/);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("R10: the built-in welcome message is plain text that never swaps to the markdown renderer", () => {
  it("`plain` renders escaped text and stays a single, unchanged <p> after the renderer has loaded", async () => {
    preloadChatRenderer();
    await import("@/components/ai/ChatMessageContent");
    const { container } = render(<LazyChatMessageContent plain content={"Hi **there** <b>x</b>"} />);
    const before = container.querySelector("p");
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("Hi **there** <b>x</b>");
    expect(container.querySelector("p")).toBe(before);
  });

  it("only the message with the welcome id is plain: any other assistant message still goes through the sanitising renderer", async () => {
    const { AiChatPanel } = await import("@/components/ai/AiChatPanel");
    const { WELCOME_MESSAGE_ID } = await import("@/hooks/useAiChat");
    const chat = {
      messages: [
        { id: WELCOME_MESSAGE_ID, role: "assistant" as const, content: "Welcome **x**" },
        { id: "1700000000000-abc", role: "assistant" as const, content: "Answer **bold** [click](javascript:alert(1))" },
      ],
      input: "",
      setInput: () => {},
      loading: false,
      error: null,
      sendMessage: async () => {},
      scrollRef: { current: null },
      inputRef: { current: null },
      handleKeyDown: () => {},
    };
    const { container } = render(
      <LanguageProvider>
        <ThemeProvider>
          <AiChatPanel chat={chat} />
        </ThemeProvider>
      </LanguageProvider>,
    );
    expect(await screen.findByText("bold")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.textContent).toContain("Welcome **x**");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
