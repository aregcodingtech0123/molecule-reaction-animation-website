# Staged database contract: Phase 2C, V7

This folder holds a **staged, versioned database-contract corpus**. It is kept here so that it can be reviewed, hashed and
verified. It is **not** part of the database setup. `MANIFEST.json` is the single source of truth for what the corpus
contains; this file states the rules.

## What this folder is not

- **Not applied by the migration runner.** The project's normal migration command (`node scripts/migrate.mjs`,
  `db:migrate`) defaults to `database/init`, and so do the setup scripts and the test-database preparation (the Vitest
  global setups, the E2E launcher and the performance seed). The underlying migration function can be given an explicit
  directory; V7 verification and the migrator's own tests do that. That is a verification method, not an operator
  procedure. Files under `database/staged` are not applied merely because they exist there, and nothing here may be added
  to `database/init` while Step 7.2 is open. A test fails if a staged file name appears in `database/init`.
- **Not production-approved.** Being present here does not approve any file for production, Neon, or any real database.
- **Not a statement that the application is ready.** The V7 contract is conditionally accepted as an SQL-level contract
  for disposable environments only. The application still uses operations that the final permission step removes, and
  SQL-level correctness must never be read as application readiness.

## What V7 verified, and what it did not

V7 verification did **not** run these files as they are written here. It ran copies in which the normal role-name prefix
`moleculestudio_` was replaced by the disposable prefix `v7v_20261109_`: `moleculestudio_app`, `moleculestudio_webhook`
and `moleculestudio_ack` became `v7v_20261109_app`, `v7v_20261109_webhook` and `v7v_20261109_ack`. The V7 substitution
record states that reversing the substitution reproduces each original file exactly, and `originalSha256` in the manifest
is the hash of those originals.

The files in this folder use the real role names and have **not** themselves been run. They still require verification
under their real role names, in a disposable environment, before the SQL is merged. Nothing here claims that V7 directly
verified the unchanged repository versions.

## The point-of-no-return artifact

The R transition (`S10-R-app-role-transition.sql`, flagged `pointOfNoReturn: true` in the manifest) is **not** an ordinary,
reversible migration.

- It is applied **only at step S10**, under a separately approved deployment plan, after the soak, and with no old
  application instance running.
- From that point the old application build is retired. **A rollback to the old build is not possible**, and the generic
  ledger writer (`post_credit_transaction`) must never be granted back, for any reason.
- Exactly one manifest entry may carry the flag, and it must be that file.
- It is kept separate from `database/roles/app-role.sql`, which stays unchanged until S10. **Never re-run
  `database/roles/app-role.sql` after R**: it grants back the privileges R removes. Neutralising or replacing that script
  is a requirement of S10.

## Deployment order

The approved deployment document named in the manifest defines the order. In outline:

- **S2:** migration 021.
- **S3:** role creation (the acknowledgement and webhook roles), followed by the read-only verification at stage
  `roles_created`.
- **S4:** migration 022.
- **S5:** the owner fills the policy tables.
- **S6:** the webhook and acknowledgement privileges.
- **S7:** the additive grants (R0).
- **S8:** the new service build is deployed. **S9:** the soak.
- **S10:** the R transition, immediately followed by the final verification.

This outline does not replace that document, and listing a step here does not approve it for any environment. The
migration runner has no stop-at option, so it cannot by itself pause between S2 and S4. That is a question for the later
move-in step, not for this folder.

## Headers in the staged SQL

Each staged SQL file starts with a **provenance banner**. It names the deployment step, says that the file is not applied by
the migration runner and not production-approved, and gives the execution status as **three separate facts**:

1. **Disposable PostgreSQL:** the V7 verification executed a copy of the file in a disposable PostgreSQL 18.6 test database,
   with the role prefix `moleculestudio_` replaced by `v7v_20261109_`.
2. **Original role names:** the file as staged, with the `moleculestudio_` role names, has not been executed anywhere.
3. **Production:** it has not been executed in production or in any other non-disposable database.

These three must never be merged into one statement such as "verified" or "never executed".

The banner and a small number of status sentences are the only header changes. The older version-history paragraphs (for
example "CHANGES IN v4" and the "V7 CORRECTION" notes) are kept because they record how each draft evolved, and they
describe the draft versions, not the staged state. Do not repeat the original draft-era claims that a file was never
executed or parsed. Only comments differ from the source drafts; the executable SQL is frozen. The one known wording
defect left in executable text is the message in migration 021 that mentions "migration 022" for goodwill; it stays
unchanged because executable text is frozen.

## Conditions that travel with the corpus

1. The contract covers exactly the files listed in `MANIFEST.json`, plus the corrected deployment document it names.
2. **Executable SQL is frozen.** Only comment changes may be considered, and only outside dollar-quoted bodies. Any change
   to executable text stops the work; it would need a new version and its own verification.
3. The repository copies must be re-verified in a disposable environment, under their real role names and including the
   runner order, before the SQL is merged. Database verification is a **separate, separately authorised phase**; this
   folder contains no test that contacts a database.
4. The original verification harness is archived outside the repository. Re-verification must not be described as
   "repeated with the V7 harness" until that is true for the run in question.
5. Counts from the V7 evidence are quoted as: about 1,200 result IDs (1,233 by the recorded counting rule, 1,223 distinct
   names), roughly 1,150 PASS assertions. The contract is never described as completely verified.
6. An independent PostgreSQL reviewer must be named before the SQL is merged. None has been named.
7. See point 3 of "What this folder is not" above.

## How the hashes work

- `originalSha256`: the original draft file, which V7 ran only as a role-substituted copy (see above).
- `sha256`: the staged file, with CRLF normalised to LF first. A checkout with `core.autocrlf=true` turns LF into CRLF,
  and the normalisation makes the two agree. The staged files are the source drafts plus comment-only header corrections,
  so `sha256` now differs from `originalSha256`: the comments changed the bytes, and with them the raw SHA-256. The
  executable SQL did not change, and `strippedSha256` is the evidence for that.
- `strippedSha256`: the file with comments removed and whitespace normalised by
  `services/auth-billing-service/tests/support/sql-comment-stripper.ts`, **only outside protected regions**. String
  literals, quoted identifiers and dollar-quoted bodies are kept exactly as written (after CRLF to LF), so a change to a
  blank line, a space or a comment inside a function body or a string literal changes this hash. A change to a header
  comment, or to the blank lines and trailing spaces between statements, does not. It is unchanged by the header
  corrections described above.

**The comment stripper is a narrow tool for this fixed corpus. It is not a general-purpose PostgreSQL SQL parser** and
must not be used or described as one. It refuses constructs outside its rules (escape strings, Unicode-escape strings, a
comment between an identifier and a dollar-quote opener, and unterminated quotes, comments or dollar quotes) instead of
guessing.

## Checks

`services/auth-billing-service/tests/unit/staged-contract-manifest.test.ts` reads these files as text. It checks the
manifest schema (no unknown keys, file names consistent with `kind` and `step`, the point-of-no-return flag only on S10),
that every `.sql` file here is listed and no listed file is missing, that no listed file is in `database/init`, each file's
hashes, the completed nine-file corpus, that every file starts with the provenance banner (with its step, the three
execution facts and the source draft) and no header repeats the old "never executed or parsed" claims, and the stripper's
behaviour on synthetic SQL. It does not read anything outside the repository and contacts no database.
