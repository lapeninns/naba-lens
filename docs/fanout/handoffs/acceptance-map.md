# Handoff: acceptance-map (`feat/nl-acceptance`)

- **Goal:** map spec §10, brief §4–§5 and ledger R1–R24 to existing tests. Run every suite
  on `3a23c9b` on an isolated stack, and list each gap as a precise missing assertion.
  Owned path: `docs/acceptance.md`. Ledger updates go in as proposals only, in its §7.
- **Status:** DONE. See `docs/acceptance.md`.
- **Done:**
  - Unit: 102 passed.
  - Integration: 84 passed, `privilege` after one rerun for an auth 504.
  - Security: 114 passed.
  - Lifecycle: 17 passed after one rerun for an auth 504.
  - Typecheck, lint and build: exit 0.
  - E2E: 3 runs, flaky under machine load. Per-test tallies are in §1.1.
- **Open:**
  - Rerun e2e on a quiet machine.
  - Triage `tests/e2e/staff-accounts.spec.ts` on mobile: the status badge did not
    update after deactivate (§1.1).
- **Stack:**
  - Workdir: `/tmp/nabalens-acceptance-stack`, project `nabalens-acceptance`, ports
    515xx.
  - Studio, realtime, analytics, edge_runtime, storage.vector and s3 are disabled.
  - It is **stopped** (`supabase --workdir /tmp/nabalens-acceptance-stack stop --no-backup`).
  - Recreate it with `docs/acceptance.md` §8.
  - Env helper (local, not committed): `/tmp/nl-acc-env.sh`.
- **Logs:** `.artifacts/acceptance/*.log` (gitignored, in this worktree).
- **Open questions:** none blocking. Wave-3 prompts are absent from `docs/fanout/`, so
  in-flight coverage was inferred from branch commits and handoffs.
