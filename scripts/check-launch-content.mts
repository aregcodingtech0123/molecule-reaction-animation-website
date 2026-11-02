/**
 * `npm run check:launch-content [-- --web <file|env>]` - fails (exit 1) while a required SITE_OWNER_* variable is empty (D6).
 *
 * The four trust pages (/about, /contact, /privacy, /terms) and the Organization JSON-LD read the operator's details from
 * SITE_OWNER_* environment variables of the WEB host (src/lib/legal/site-owner.ts). While any required one is empty or
 * invalid those pages are noindex, out of the sitemap, without Organization JSON-LD, and this check fails. It prints
 * variable NAMES (and the rule a bad value broke), never a value.
 *
 *   --web env         (default) read this process's environment
 *   --web <file>      read a dotenv file, e.g. a faithful export of the web host's variables (the same file check:config takes)
 *
 * Exit 0 = every required variable is set and valid, 1 = something is missing or invalid, 64 = usage error.
 * It cannot see what the host's dashboard really holds and it cannot judge the legal text: that needs a lawyer.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { blockingFields, invalidReason, LEGAL_REVIEWED_ENV, readSiteOwner, type Env } from "../src/lib/legal/site-owner";

export interface LaunchContentResult {
  /** One line per required variable that is empty, and per set variable that fails its check. */
  problems: string[];
  /** Things worth knowing that do not fail the check. */
  notes: string[];
}

export function checkLaunchContent(env: Env): LaunchContentResult {
  const status = readSiteOwner(env);
  const problems: string[] = [];
  for (const field of status.empty) problems.push(`${field.env} is empty - ${field.use}`);
  for (const field of status.invalid) problems.push(`${field.env} ${invalidReason(field)} - it will not be shown${field.required ? " and the trust pages stay noindex" : ""}`);
  const notes: string[] = [];
  if (!status.legalReviewed) {
    notes.push(`${LEGAL_REVIEWED_ENV} is not "true": the four pages still show the "Draft - needs legal review" notice. Set it only after a lawyer has reviewed /privacy and /terms.`);
  }
  // Defensive: the pages' own gate and this check must agree.
  const gate = blockingFields(status).length;
  if (gate !== status.empty.length + status.invalid.filter((f) => f.required).length) problems.push("internal: gate and check disagree");
  return { problems, notes };
}

function usage(message: string): never {
  console.error(`[check:launch-content] ${message}`);
  console.error("Usage: npm run check:launch-content [-- --web <file|env>]");
  process.exit(64);
}

function readEnvSpec(argv: string[], processEnv: Env): Env {
  let spec = "env";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--web") usage(`Unknown argument ${JSON.stringify(argv[i])}.`);
    spec = argv[++i] ?? "";
    if (!spec) usage('--web needs a file path or "env".');
  }
  if (spec === "env") return processEnv;
  const file = path.resolve(spec);
  if (!fs.existsSync(file)) usage(`env file not found: ${spec}`);
  try {
    return parseEnv(fs.readFileSync(file, "utf8")) as Env;
  } catch {
    usage(`env file could not be parsed as dotenv: ${spec}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = readEnvSpec(process.argv.slice(2), { ...process.env });
  const { problems, notes } = checkLaunchContent(env);
  for (const p of problems) console.error(`PROBLEM  ${p}`);
  for (const n of notes) console.log(`note     ${n}`);
  if (problems.length) {
    console.error(`[check:launch-content] ${problems.length} problem(s) - the trust pages stay noindex and out of the sitemap; not ready for launch.`);
    process.exit(1);
  }
  console.log("[check:launch-content] every required SITE_OWNER_* variable is set. The privacy policy and terms still need legal review before launch.");
}
