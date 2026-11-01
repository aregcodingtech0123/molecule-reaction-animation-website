/** What the profile form sends: only changes, null to clear, no validation of fields that stay empty (GOOGLE_PROFILE_DESIGN §3). */
import { describe, expect, it } from "vitest";
import { buildProfileUpdate } from "@/lib/auth/profile-update";

const EMPTY = { firstName: "", lastName: "", dateOfBirth: "" };
const FULL = { firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-12-10" };

describe("buildProfileUpdate", () => {
  it("a Google account (all empty) entering only a first name sends only the first name", () => {
    expect(buildProfileUpdate(EMPTY, { ...EMPTY, firstName: " Ada " })).toEqual({ updates: { firstName: "Ada" }, error: null });
  });

  it("nothing changed, or still empty → nothing to send, and no 'required' error", () => {
    expect(buildProfileUpdate(EMPTY, EMPTY)).toEqual({ updates: {}, error: null });
    expect(buildProfileUpdate(FULL, FULL)).toEqual({ updates: {}, error: null });
  });

  it("emptying a stored field sends null (clear); the other fields are untouched", () => {
    expect(buildProfileUpdate(FULL, { ...FULL, lastName: "  " })).toEqual({ updates: { lastName: null }, error: null });
    expect(buildProfileUpdate(FULL, EMPTY)).toEqual({ updates: { firstName: null, lastName: null, dateOfBirth: null }, error: null });
  });

  it("a changed value is sent trimmed; an unchanged one is not", () => {
    expect(buildProfileUpdate(FULL, { ...FULL, firstName: "Augusta ", dateOfBirth: "1991-01-02" })).toEqual({
      updates: { firstName: "Augusta", dateOfBirth: "1991-01-02" },
      error: null,
    });
  });

  it.each([
    [{ firstName: "<script>" }, /invalid characters/],
    [{ lastName: "x".repeat(101) }, /at most 100/],
    [{ dateOfBirth: "10/12/1990" }, /YYYY-MM-DD/],
    [{ dateOfBirth: "1850-01-01" }, /out of allowed range/],
  ])("a filled but invalid field is reported and nothing is sent: %j", (change, message) => {
    const result = buildProfileUpdate(FULL, { ...FULL, ...change });
    expect(result.updates).toBeNull();
    expect(result.error).toMatch(message);
  });
});
