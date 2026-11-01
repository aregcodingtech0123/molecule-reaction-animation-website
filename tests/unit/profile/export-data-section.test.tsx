/** "Download my data": re-authentication, the download itself, and what the page shows on failure. */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderWithProviders, routeFetch } from "../../support/mocks";

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const googleCredential = vi.hoisted(() => ({ fire: null as null | ((idToken: string) => void | Promise<void>) }));
vi.mock("@/components/auth/GoogleSignInButton", () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (t: string) => void | Promise<void> }) => {
    googleCredential.fire = onCredential;
    return <button type="button">google-button</button>;
  },
}));

import { ExportDataSection } from "@/components/profile/ExportDataSection";

const EXPORT = {
  exportedAt: "2026-11-01T10:00:00.000Z",
  account: { id: "u1", email: "me@example.test" },
  linkedSignIn: [],
  credits: { balance: 3 },
  creditLedger: [],
  checkoutOrders: [],
  aiCreditHolds: [],
  notes: [],
};
let created: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  created = [];
  downloads = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:test"), revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const submit = () => fireEvent.click(screen.getByRole("button", { name: /download my data/i }));
const typePassword = (v: string) => fireEvent.change(screen.getByLabelText(/confirm with your password/i), { target: { value: v } });

describe("ExportDataSection", () => {
  it("asks for the password first: an empty password sends nothing", async () => {
    const fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ExportDataSection />);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/enter your password/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the password (never in the URL), downloads one JSON file named by date only, and clears the field", async () => {
    let body = "";
    let url = "";
    vi.stubGlobal("fetch", routeFetch({ "POST /api/users/export": (init, u) => ((body = String(init?.body)), (url = u), json({ success: true, data: EXPORT })) }));
    renderWithProviders(<ExportDataSection />);
    typePassword("Correct-horse-9");
    submit();
    await waitFor(() => expect(downloads).toEqual(["moleculestudio-my-data-2026-11-01.json"]));
    expect(JSON.parse(body)).toEqual({ password: "Correct-horse-9" });
    expect(url).not.toContain("Correct-horse");
    expect(JSON.parse(await created[0]!.text())).toEqual(EXPORT);
    expect((screen.getByLabelText(/confirm with your password/i) as HTMLInputElement).value).toBe("");
  });

  it("a wrong password shows the service's message, downloads nothing, and does not sign the user out (403)", async () => {
    vi.stubGlobal("fetch", routeFetch({ "POST /api/users/export": () => json({ success: false, error: "Password or Google sign-in did not match this account.", code: "REAUTH_FAILED" }, 403) }));
    renderWithProviders(<ExportDataSection />);
    typePassword("nope");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not match/i);
    expect(downloads).toEqual([]);
  });

  it("too many attempts (429) is explained", async () => {
    vi.stubGlobal("fetch", routeFetch({ "POST /api/users/export": () => json({ success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 3600 }, 429) }));
    renderWithProviders(<ExportDataSection />);
    typePassword("x");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("a Google account confirms with a fresh Google credential: the id token is posted instead of a password", async () => {
    let body = "";
    vi.stubGlobal("fetch", routeFetch({ "POST /api/users/export": (init) => ((body = String(init?.body)), json({ success: true, data: EXPORT })) }));
    renderWithProviders(<ExportDataSection />);
    await act(async () => {
      await googleCredential.fire!("google.id.token");
    });
    expect(JSON.parse(body)).toEqual({ idToken: "google.id.token" });
    await waitFor(() => expect(downloads).toHaveLength(1));
  });
});
