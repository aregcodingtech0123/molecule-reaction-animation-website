import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAuth, renderWithProviders } from "../../support/mocks";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/GoogleSignInButton", () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (t: string) => void }) => (
    <button type="button" onClick={() => onCredential("google-id-token")}>
      Google
    </button>
  ),
}));

import { AuthModal } from "@/components/auth/AuthModal";

function open(mode: "login" | "register", overrides: Record<string, unknown> = {}) {
  auth.current = makeAuth({ authModalOpen: true, authModalMode: mode, ...overrides });
  renderWithProviders(<AuthModal />);
  return auth.current as ReturnType<typeof makeAuth>;
}

const field = (type: string) => document.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
const submit = () => screen.getByRole("button", { name: /log in|create account/i, hidden: false });

describe("AuthModal", () => {
  beforeEach(() => {
    auth.current = makeAuth();
  });

  it("renders nothing while closed", () => {
    renderWithProviders(<AuthModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("login: validates required/format/length client-side and never calls the API on invalid input", async () => {
    const user = userEvent.setup();
    const ctx = open("login");
    const form = document.querySelector("form")!;

    await user.click(form.querySelector('button[type="submit"]')!);
    expect(screen.getByRole("alert")).toHaveTextContent("Email is required.");

    await user.type(field("email"), "nope");
    // Native type=email validation blocks a click-submit; dispatch submit to reach the app validator.
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");

    await user.clear(field("email"));
    await user.type(field("email"), "ada@example.test");
    await user.type(field("password"), "short");
    await user.click(form.querySelector('button[type="submit"]')!);
    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(ctx.login).not.toHaveBeenCalled();
  });

  it("login: submits trimmed email and the raw password", async () => {
    const user = userEvent.setup();
    const ctx = open("login");
    await user.type(field("email"), "  ada@example.test  ");
    await user.type(field("password"), " pass word 1 ");
    await user.click(document.querySelector('form button[type="submit"]')!);
    expect(ctx.login).toHaveBeenCalledWith("ada@example.test", " pass word 1 ");
  });

  it("login: server 'Invalid email or password.' is shown as the generic invalid-credentials message", async () => {
    const user = userEvent.setup();
    open("login", { login: vi.fn().mockRejectedValue(new Error("Invalid email or password.")) });
    await user.type(field("email"), "ada@example.test");
    await user.type(field("password"), "Wrong-pass-1");
    await user.click(document.querySelector('form button[type="submit"]')!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid credentials/i);
  });

  it("register: enforces letter+digit, names and date of birth before calling register", async () => {
    const user = userEvent.setup();
    const ctx = open("register");
    await user.type(field("email"), "new@example.test");
    await user.type(field("password"), "allletters");
    await user.click(document.querySelector('form button[type="submit"]')!);
    expect(screen.getByRole("alert")).toHaveTextContent(/number/i);

    await user.clear(field("password"));
    await user.type(field("password"), "Letters123");
    await user.click(document.querySelector('form button[type="submit"]')!);
    expect(screen.getByRole("alert")).toBeInTheDocument(); // names/dob missing
    expect(ctx.register).not.toHaveBeenCalled();
  });

  it("register: submits the full profile", async () => {
    const user = userEvent.setup();
    const ctx = open("register");
    const [first, last] = document.querySelectorAll<HTMLInputElement>('input[type="text"]');
    await user.type(first!, " Ada ");
    await user.type(last!, "Lovelace");
    await user.type(field("date"), "1990-12-10");
    await user.type(field("email"), "ada@example.test");
    await user.type(field("password"), "Letters123");
    await user.click(document.querySelector('form button[type="submit"]')!);
    await waitFor(() =>
      expect(ctx.register).toHaveBeenCalledWith("ada@example.test", "Letters123", {
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-12-10",
      }),
    );
  });

  it("switching tabs requests the other mode", async () => {
    const user = userEvent.setup();
    const ctx = open("login");
    await user.click(screen.getByRole("button", { name: "Sign Up" }));
    expect(ctx.openAuthModal).toHaveBeenCalledWith("register");
  });

  it("Google credential is passed to loginWithGoogle", async () => {
    const user = userEvent.setup();
    const ctx = open("login");
    await user.click(screen.getByRole("button", { name: "Google" }));
    expect(ctx.loginWithGoogle).toHaveBeenCalledWith("google-id-token");
  });

  it("inputs are disabled while a request is in flight", () => {
    open("login", { isAuthLoading: true });
    expect(field("email")).toBeDisabled();
    expect(field("password")).toBeDisabled();
  });

  it("close button and backdrop call closeAuthModal", async () => {
    const user = userEvent.setup();
    const ctx = open("login");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Close authentication dialog" }));
    expect(ctx.closeAuthModal).toHaveBeenCalledTimes(2);
  });

  it("uses the password input type (never echoes the password)", () => {
    open("login");
    expect(field("password")).toHaveAttribute("autocomplete", "current-password");
  });

  void submit;
});
