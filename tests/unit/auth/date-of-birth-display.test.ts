/**
 * FINDING-06 (display half): a calendar date ("YYYY-MM-DD") must render as the
 * same day in every browser time zone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { formatDateOfBirthForDisplay } from "@/lib/auth/profile-validation";

const savedTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = savedTz;
});

describe("formatDateOfBirthForDisplay (FINDING-06)", () => {
  it.each([["UTC"], ["America/Los_Angeles"], ["Pacific/Pago_Pago"], ["Asia/Tokyo"], ["Pacific/Kiritimati"]])(
    "shows 10 December 1990 in %s",
    (tz) => {
      process.env.TZ = tz;
      expect(formatDateOfBirthForDisplay("1990-12-10", "en-GB")).toBe("10 December 1990");
    },
  );

  it("empty → em dash; malformed input is shown as-is", () => {
    expect(formatDateOfBirthForDisplay("")).toBe("—");
    expect(formatDateOfBirthForDisplay("not-a-date")).toBe("not-a-date");
  });
});
