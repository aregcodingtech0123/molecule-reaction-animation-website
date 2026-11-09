/**
 * maskConnectionString runs on every startup log. pg also reads credentials from the query string (`?password=`,
 * `?sslpassword=`), so masking only the URL's password part is not enough. Query parameters are kept only when they are
 * known to carry no secret; every other value is masked, so an unknown or future parameter fails safe.
 */
import { describe, expect, it } from "vitest";
import { maskConnectionString } from "../../src/db/diagnostics.js";

const MARKER = "SECRETMARKER123";

describe("maskConnectionString", () => {
  it("masks the password in the URL", () => {
    const masked = maskConnectionString(`postgresql://user:${MARKER}@db.example:5432/app`);
    expect(masked).not.toContain(MARKER);
    expect(masked).toContain("user:****@db.example:5432/app");
  });

  it.each(["password", "PASSWORD", "Password", "sslpassword", "sslkey", "passfile", "some_future_parameter"])("masks the value of the query parameter %s", (name) => {
    const masked = maskConnectionString(`postgresql://user@db.example/app?${name}=${MARKER}`);
    expect(masked).not.toContain(MARKER);
    expect(masked).toContain(`${name}=`);
  });

  it("masks a percent-encoded value and a repeated parameter", () => {
    const masked = maskConnectionString(`postgresql://user@db.example/app?password=${MARKER}%21&password=${MARKER}2`);
    expect(masked).not.toContain(MARKER);
  });

  it("keeps the parameters an operator needs and that hold no secret", () => {
    const masked = maskConnectionString("postgresql://user:pw@db.example/app?sslmode=require&channel_binding=require&connect_timeout=5&application_name=billing");
    expect(masked).toContain("sslmode=require");
    expect(masked).toContain("channel_binding=require");
    expect(masked).toContain("connect_timeout=5");
    expect(masked).toContain("application_name=billing");
  });

  it("an unparseable URL is never echoed", () => {
    expect(maskConnectionString(`not a url ${MARKER}`)).toBe("<invalid DATABASE_URL>");
  });
});
