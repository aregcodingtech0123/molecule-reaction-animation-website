/**
 * D6: the launch check fails, naming the variables, while a required SITE_OWNER_* variable is empty or invalid, and passes once
 * every one is set. It prints variable names and rules, never values.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkLaunchContent } from "../../scripts/check-launch-content.mjs";
import { OWNER_FIELDS, REQUIRED_FIELDS } from "@/lib/legal/site-owner";
import { FULL_OWNER_ENV, OPTIONAL_OWNER_VARS, ownerEnvWithout } from "../support/site-owner-env";

const root = path.resolve(__dirname, "../..");
const tsx = "services/auth-billing-service/node_modules/tsx/dist/cli.mjs";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-content-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function envFile(name: string, env: Record<string, string>): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"));
  return file;
}
function run(args: string[], env: Record<string, string> = {}) {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith("SITE_OWNER_")) delete clean[k];
  return spawnSync(process.execPath, [tsx, "scripts/check-launch-content.mts", ...args], { cwd: root, encoding: "utf8", env: { ...clean, ...env } });
}

describe("check:launch-content (pure check)", () => {
  it("with nothing set: one problem per required variable, each naming it and what it is for; the optional ones are not mentioned", () => {
    const { problems } = checkLaunchContent({});
    expect(REQUIRED_FIELDS).toHaveLength(14);
    expect(problems).toHaveLength(REQUIRED_FIELDS.length);
    for (const f of REQUIRED_FIELDS) expect(problems.join("\n"), f.env).toContain(`${f.env} is empty`);
    for (const f of OWNER_FIELDS.filter((x) => !x.required)) expect(problems.join("\n"), f.env).not.toContain(f.env);
  });

  it("all required set: passes - the optional ones may all be absent", () => {
    expect(checkLaunchContent(FULL_OWNER_ENV).problems).toEqual([]);
    expect(checkLaunchContent(ownerEnvWithout(...OPTIONAL_OWNER_VARS)).problems).toEqual([]);
  });

  it("one empty, whitespace-only or missing required variable is enough to fail, and only that one is named", () => {
    for (const value of [undefined, "", "   ", "\n\n"]) {
      const { problems } = checkLaunchContent({ ...FULL_OWNER_ENV, SITE_OWNER_REFUND_POLICY: value });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("SITE_OWNER_REFUND_POLICY is empty");
    }
  });

  it("a set but malformed value fails, naming the rule and not the value; a malformed optional one fails too", () => {
    const a = checkLaunchContent({ ...FULL_OWNER_ENV, SITE_OWNER_CONTACT_EMAIL: "someone at example" }).problems;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/^SITE_OWNER_CONTACT_EMAIL is not a single e-mail address .* stay noindex$/);
    expect(a[0]).not.toContain("someone at example");
    const b = checkLaunchContent({ ...FULL_OWNER_ENV, SITE_OWNER_EFFECTIVE_DATE: "2026-02-30" }).problems;
    expect(b).toEqual([expect.stringContaining("SITE_OWNER_EFFECTIVE_DATE is not a real date in the form YYYY-MM-DD")]);
    const c = checkLaunchContent({ ...FULL_OWNER_ENV, SITE_OWNER_EMAIL_TOMBSTONE_GUARD: "yes" }).problems;
    expect(c).toEqual([expect.stringContaining('SITE_OWNER_EMAIL_TOMBSTONE_GUARD must start with "enabled" or "disabled"')]);
    const d = checkLaunchContent({ ...FULL_OWNER_ENV, SITE_OWNER_PHONE: "abc" }).problems;
    expect(d).toEqual([expect.stringContaining("SITE_OWNER_PHONE is not a telephone number")]);
    expect(d[0]).not.toContain("stay noindex"); // optional: only its own value is dropped
  });

  it("the draft notice is a note, not a failure: SITE_OWNER_LEGAL_REVIEWED=true removes the note", () => {
    const without = checkLaunchContent(ownerEnvWithout("SITE_OWNER_LEGAL_REVIEWED"));
    expect(without.problems).toEqual([]);
    expect(without.notes.join("\n")).toContain("SITE_OWNER_LEGAL_REVIEWED");
    expect(checkLaunchContent(FULL_OWNER_ENV).notes).toEqual([]);
  });
});

describe("npm run check:launch-content (CLI)", () => {
  it("default (the process environment): exit 1 today, names every required variable, prints no value", () => {
    const res = run([]);
    expect(res.status, res.stderr).toBe(1);
    for (const f of REQUIRED_FIELDS) expect(res.stderr, f.env).toContain(f.env);
    expect(res.stderr).toMatch(/14 problem\(s\) - the trust pages stay noindex and out of the sitemap; not ready for launch/);
  });

  it("the process environment is read: a complete set of variables exits 0", () => {
    const res = run([], FULL_OWNER_ENV);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("every required SITE_OWNER_* variable is set");
  });

  it("--web <file>: exit 1 for a partial file (only the missing names, no values), 0 for a complete one", () => {
    const secretMarker = "value-that-must-never-be-printed";
    const partial = envFile("partial.env", { ...ownerEnvWithout("SITE_OWNER_COUNTRY", "SITE_OWNER_CONTACT_EMAIL"), SITE_OWNER_LEGAL_NAME: secretMarker });
    const bad = run(["--web", partial]);
    expect(bad.status, bad.stderr).toBe(1);
    expect(bad.stderr).toContain("SITE_OWNER_COUNTRY is empty");
    expect(bad.stderr).toContain("SITE_OWNER_CONTACT_EMAIL is empty");
    expect(bad.stderr).toMatch(/2 problem\(s\)/);
    expect(bad.stderr + bad.stdout).not.toContain(secretMarker);
    const good = run(["--web", envFile("full.env", FULL_OWNER_ENV)]);
    expect(good.status, good.stderr).toBe(0);
    for (const v of Object.values(FULL_OWNER_ENV)) expect(good.stdout + good.stderr).not.toContain(v);
  });

  it("usage errors exit 64", () => {
    expect(run(["--bogus"]).status).toBe(64);
    expect(run(["--web"]).status).toBe(64);
    expect(run(["--web", path.join(tmp, "missing.env")]).status).toBe(64);
  });
});
