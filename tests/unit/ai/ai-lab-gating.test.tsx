/**
 * AI Lab gating states, driven through the real useAiChat hook with /api/chat
 * doubled at fetch: logged out / unverified / no credits / has credits / 402 from server.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, makeAuth, routeFetch, signedIn, testUser } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { LanguageProvider } from "@/context/LanguageContext";
import { useAiChat, AUTH_GATE_LOGIN_MESSAGE, AUTH_GATE_VERIFY_MESSAGE } from "@/hooks/useAiChat";

const wrapper = ({ children }: { children: React.ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

async function send(text = "What is benzene?") {
  const hook = renderHook(() => useAiChat({ autoScroll: false }), { wrapper });
  act(() => hook.result.current.setInput(text));
  await act(() => hook.result.current.sendMessage());
  return hook.result;
}

const lastAssistant = (r: { current: ReturnType<typeof useAiChat> }) =>
  r.current.messages.filter((m) => m.role === "assistant").at(-1)!.content;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("AI Lab gating", () => {
  it("logged out: no request, sign-in prompt, login modal opened", async () => {
    const ctx = makeAuth();
    auth.current = ctx;
    const r = await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastAssistant(r)).toBe(AUTH_GATE_LOGIN_MESSAGE);
    expect(ctx.openAuthModal).toHaveBeenCalledWith("login");
  });

  it("signed in but unverified: no request, verification prompt", async () => {
    auth.current = signedIn({ user: { ...testUser, isVerified: false } });
    const r = await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastAssistant(r)).toBe(AUTH_GATE_VERIFY_MESSAGE);
  });

  it("no credits (balance 0): no request, billing modal opened", async () => {
    const ctx = signedIn({ credits: 0 });
    auth.current = ctx;
    await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.openBillingModal).toHaveBeenCalled();
  });

  it("has credits: sends history without the welcome message, appends the reply, refreshes balance", async () => {
    const ctx = signedIn({ credits: 5 });
    auth.current = ctx;
    let body: { messages: unknown[] } | undefined;
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "POST /api/chat": (init) => {
          body = JSON.parse(String(init?.body));
          return json({ message: "Benzene is C6H6.", balance: 4 });
        },
      }),
    );
    const r = await send("What is benzene?");
    expect(body).toEqual({ messages: [{ role: "user", content: "What is benzene?" }] });
    expect(lastAssistant(r)).toBe("Benzene is C6H6.");
    expect(ctx.fetchBalance).toHaveBeenCalled();
    expect(r.current.loading).toBe(false);
  });

  it("server 402 (balance drained elsewhere): shows the server's shortfall and opens billing", async () => {
    const ctx = signedIn({ credits: 1 });
    auth.current = ctx;
    vi.stubGlobal("fetch", routeFetch({ "POST /api/chat": () => json({ code: "INSUFFICIENT_CREDITS", requiredCredits: 1, balance: 0 }, 402) }));
    const r = await send();
    expect(lastAssistant(r)).toBe("This operation needs 1 credit. You have 0. Please top up.");
    expect(ctx.openBillingModal).toHaveBeenCalledWith("This operation needs 1 credit. You have 0. Please top up.");
    expect(r.current.error).toBe("INSUFFICIENT_CREDITS");
  });

  it("server 403 EMAIL_NOT_VERIFIED: shows the verification prompt", async () => {
    auth.current = signedIn({ credits: 3 });
    vi.stubGlobal("fetch", routeFetch({ "POST /api/chat": () => json({ error: "EMAIL_NOT_VERIFIED" }, 403) }));
    const r = await send();
    expect(lastAssistant(r)).toBe(AUTH_GATE_VERIFY_MESSAGE);
  });

  it("server 502: error surfaced, loading cleared, the user's message is kept", async () => {
    auth.current = signedIn({ credits: 3 });
    vi.stubGlobal("fetch", routeFetch({ "POST /api/chat": () => json({ error: "AI_SERVICE_UNAVAILABLE" }, 502) }));
    const r = await send("hello");
    expect(r.current.error).toBe("AI_SERVICE_UNAVAILABLE");
    expect(r.current.loading).toBe(false);
    expect(r.current.messages.some((m) => m.role === "user" && m.content === "hello")).toBe(true);
  });

  it("blank input is ignored", async () => {
    auth.current = signedIn({ credits: 3 });
    await send("   ");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
