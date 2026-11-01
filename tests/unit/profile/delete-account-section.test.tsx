/** "Delete my account": the forfeit warning (verbatim), re-authentication, sign-out on success, and cancelling a pending request. */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, makeAuth, navigationMock, renderWithProviders, router, routeFetch } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => navigationMock);
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const googleCredential = vi.hoisted(() => ({ fire: null as null | ((idToken: string) => void | Promise<void>) }));
vi.mock("@/components/auth/GoogleSignInButton", () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (t: string) => void | Promise<void> }) => {
    googleCredential.fire = onCredential;
    return <button type="button">google-button</button>;
  },
}));

import { DeleteAccountSection, forfeitWarning } from "@/components/profile/DeleteAccountSection";

const balance = (n: number) => () => json({ success: true, data: { userId: "u1", balance: n, hasCredits: n > 0 } });
const logout = vi.fn();
beforeEach(() => {
  logout.mockReset();
  router.replace.mockReset();
  auth.current = makeAuth({ logout });
});
const deleteButton = () => screen.getByRole("button", { name: /delete my account after 14 days/i }) as HTMLButtonElement;
const confirm = () => fireEvent.click(deleteButton());
const typePassword = (v: string) => fireEvent.change(screen.getByLabelText(/confirm deletion with your password/i), { target: { value: v } });

const WARNING = (n: number) =>
  `If you delete your account, your remaining ${n} credits are permanently lost and cannot be restored. Deletion takes effect after a 14-day grace period, during which you can cancel.`;

describe("the warning", () => {
  it("says exactly what the owner approved, with the current balance", async () => {
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/balance": balance(7) }));
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    const warning = await screen.findByTestId("forfeit-warning");
    await waitFor(() => expect(warning.textContent).toContain("7"));
    expect(warning.textContent).toBe(WARNING(7));
    expect(forfeitWarning(0)).toBe(WARNING(0));
  });

  it("deletion stays unavailable until the balance is known (and says why if it cannot be loaded)", async () => {
    vi.stubGlobal("fetch", routeFetch({ "GET /api/billing/balance": () => json({ success: false, error: "down" }, 503) }));
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/balance could not be loaded/i);
    expect(deleteButton().disabled).toBe(true);
  });
});

describe("asking for deletion", () => {
  it("needs the password; a wrong one shows the message from the service and does not sign out", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": balance(3),
        "POST /api/users/deletion": () => json({ success: false, error: "Password or Google sign-in did not match this account.", code: "REAUTH_FAILED" }, 403),
      }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    await waitFor(() => expect(deleteButton().disabled).toBe(false));
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent(/enter your password/i);
    typePassword("nope");
    confirm();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/did not match/i));
    expect(logout).not.toHaveBeenCalled();
  });

  it("posts the password in the body only, then signs out and goes home", async () => {
    let body = "";
    let url = "";
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": balance(3),
        "POST /api/users/deletion": (init, u) => ((body = String(init?.body)), (url = u), json({ success: true, data: { scheduledFor: "2026-11-20T10:00:00.000Z" } })),
      }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    await waitFor(() => expect(deleteButton().disabled).toBe(false));
    typePassword("Correct-horse-9");
    confirm();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(JSON.parse(body)).toEqual({ password: "Correct-horse-9" });
    expect(url).not.toContain("Correct-horse");
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("a Google account confirms with a fresh Google credential", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": balance(0),
        "POST /api/users/deletion": (init) => ((body = String(init?.body)), json({ success: true, data: { scheduledFor: "2026-11-20T10:00:00.000Z" } })),
      }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("forfeit-warning").textContent).toContain("0 credits"));
    await act(async () => {
      await googleCredential.fire!("google.id.token");
    });
    expect(JSON.parse(body)).toEqual({ idToken: "google.id.token" });
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("too many attempts (429) is explained and nothing signs out", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "GET /api/billing/balance": balance(1), "POST /api/users/deletion": () => json({ success: false, error: "TOO_MANY_ATTEMPTS" }, 429) }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor={null} onCancelled={() => undefined} />);
    await waitFor(() => expect(deleteButton().disabled).toBe(false));
    typePassword("x");
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
    expect(logout).not.toHaveBeenCalled();
  });
});

describe("a pending request", () => {
  it("shows the date and a Cancel deletion button that calls DELETE and tells the page", async () => {
    let called = false;
    const onCancelled = vi.fn();
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "GET /api/billing/balance": balance(5),
        "DELETE /api/users/deletion": () => ((called = true), json({ success: true, data: { cancelled: true } })),
      }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor="2026-11-20T10:00:00.000Z" onCancelled={onCancelled} />);
    expect(screen.getByText(/account deletion scheduled/i)).toBeTruthy();
    // The date is shown in the visitor's own locale; compute the expectation the same way.
    expect(screen.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(new Date("2026-11-20T10:00:00.000Z")))).toBeTruthy();
    expect(screen.queryByLabelText(/confirm deletion with your password/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cancel deletion/i }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(called).toBe(true);
  });

  it("a failed cancel is reported and the page is not told it worked", async () => {
    const onCancelled = vi.fn();
    vi.stubGlobal(
      "fetch",
      routeFetch({ "GET /api/billing/balance": balance(5), "DELETE /api/users/deletion": () => json({ success: false, error: "Authentication required." }, 500) }),
    );
    renderWithProviders(<DeleteAccountSection scheduledFor="2026-11-20T10:00:00.000Z" onCancelled={onCancelled} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel deletion/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authentication required/i);
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
