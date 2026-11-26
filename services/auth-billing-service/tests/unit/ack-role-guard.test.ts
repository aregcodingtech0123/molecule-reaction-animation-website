/**
 * O-21 test-infrastructure guard (tests/support/ack-role.ts) — DATABASE-FREE. Proves that the helper refuses every target that
 * is not demonstrably a disposable test cluster before anything privileged could run, that the ACK URL changes only the user
 * name and never carries a password, and that the staged S3/S6 files run only when they match MANIFEST.json. The run-time part
 * (superuser, PostgreSQL 18, fsync signature, same cluster identity, real login identity) needs a database and is exercised by
 * the database-backed suites.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACK_ROLE, ackUrlFor, disposableTarget, loadStagedAckSql, provisionAckRole } from "../support/ack-role";

const LOCAL = "postgresql://postgres@127.0.0.1:55432/moleculestudio_api_test";
const CI_URL = "postgresql://postgres@localhost:5432/moleculestudio_api_test";
const GH = { GITHUB_ACTIONS: "true", CI: "true", RUNNER_ENVIRONMENT: "github-hosted" };

describe("disposableTarget: only the two known disposable clusters", () => {
  it("accepts the local test cluster (127.0.0.1:55432, trust, *_test)", () => {
    expect(disposableTarget(LOCAL, {})).toEqual({ ok: true, mode: "local" });
  });

  it("accepts the CI service container only on GitHub Actions", () => {
    expect(disposableTarget(CI_URL, GH)).toEqual({ ok: true, mode: "ci" });
    expect(disposableTarget(CI_URL, {}).ok).toBe(false);
    expect(disposableTarget(CI_URL, { GITHUB_ACTIONS: "true" }).ok).toBe(false);
    expect(disposableTarget(CI_URL, { CI: "true" }).ok).toBe(false);
    expect(disposableTarget(CI_URL, { ...GH, RUNNER_ENVIRONMENT: "self-hosted" }).ok).toBe(false);
    expect(disposableTarget(CI_URL, { GITHUB_ACTIONS: "true", CI: "true" }).ok).toBe(false);
  });

  it.each([
    ["a developer database on 5432 outside CI", "postgresql://postgres@127.0.0.1:5432/moleculestudio_api_test", {}],
    ["any other port", "postgresql://postgres@127.0.0.1:6543/moleculestudio_api_test", GH],
    ["a non-loopback host", "postgresql://postgres@db.example.com:55432/moleculestudio_api_test", GH],
    ["the docker network alias", "postgresql://postgres@postgres:55432/moleculestudio_api_test", {}],
    ["a URL with a password", "postgresql://postgres:pw@127.0.0.1:55432/moleculestudio_api_test", {}],
    ["a name that merely contains test", "postgresql://postgres@127.0.0.1:55432/test_production", {}],
    ["a non-test database", "postgresql://postgres@127.0.0.1:55432/moleculestudio", {}],
    ["the postgres database", "postgresql://postgres@127.0.0.1:55432/postgres", {}],
    ["another scheme", "mysql://postgres@127.0.0.1:55432/moleculestudio_api_test", {}],
    ["garbage", "not a url", {}],
  ])("refuses %s", (_label, url, env) => {
    expect(disposableTarget(url, env as NodeJS.ProcessEnv).ok).toBe(false);
  });

  it("a refused target is reported without any privileged step (no connection is attempted)", async () => {
    // Nothing listens on this port; a connection attempt would reject instead of returning the refusal.
    await expect(provisionAckRole("postgresql://postgres@127.0.0.1:5432/moleculestudio_api_test", {})).resolves.toMatchObject({ ok: false });
  });
});

describe("ackUrlFor: the test URL with only the user name replaced", () => {
  it("keeps host, port, database and parameters; no password", () => {
    const ack = new URL(ackUrlFor(`${LOCAL}?application_name=x`));
    expect(ack.username).toBe(ACK_ROLE);
    expect(ack.password).toBe("");
    expect(ack.host).toBe("127.0.0.1:55432");
    expect(ack.pathname).toBe("/moleculestudio_api_test");
    expect(ack.searchParams.get("application_name")).toBe("x");
  });

  it("drops a password rather than reusing the setup user's", () => {
    expect(new URL(ackUrlFor("postgresql://postgres:pw@127.0.0.1:55432/a_test")).password).toBe("");
  });
});

describe("loadStagedAckSql: the staged contract runs only as hashed in MANIFEST.json", () => {
  const stagedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../database/staged/phase-2c-v7");

  it("loads exactly S3-ack-role-creation.sql and S6-ack-role-deployment.sql, unchanged", () => {
    const sql = loadStagedAckSql(stagedDir);
    expect(Object.keys(sql).sort()).toEqual(["S3-ack-role-creation.sql", "S6-ack-role-deployment.sql"]);
    for (const [file, text] of Object.entries(sql)) {
      expect(text).toBe(fs.readFileSync(path.join(stagedDir, file), "utf8"));
      expect(text).toContain("moleculestudio_ack");
    }
  });

  it("refuses a file whose bytes differ from the manifest", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ack-role-"));
    try {
      for (const f of ["MANIFEST.json", "S3-ack-role-creation.sql", "S6-ack-role-deployment.sql"]) {
        fs.copyFileSync(path.join(stagedDir, f), path.join(tmp, f));
      }
      fs.appendFileSync(path.join(tmp, "S6-ack-role-deployment.sql"), "\nGRANT ALL ON ai_credit_holds TO moleculestudio_ack;\n");
      expect(() => loadStagedAckSql(tmp)).toThrow(/does not match its MANIFEST\.json sha256/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
