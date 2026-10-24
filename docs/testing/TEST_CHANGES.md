# Test changes during remediation (Phase 1.5)

Every Phase 1 test that was modified, replaced or removed while fixing a finding is recorded here
as **old → new**, with the reason and why the money/security intent is at least as strong as before.
Approved scope: the test-change table from the Step 0 design review (branch `fix/phase1-findings`).

Not listed: tests whose only change is removing an `it.fails` / `test.fail` marker because the
finding was fixed — those are unchanged assertions that now pass.

| # | Finding | File | Old test | New test | Why intent is preserved or strengthened |
| --- | --- | --- | --- | --- | --- |
