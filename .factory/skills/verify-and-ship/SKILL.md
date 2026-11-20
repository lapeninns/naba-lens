---
name: verify-and-ship
description: Validate a Naba-Lens change with focused checks and qualify the exact reviewed PR head.
---

1. Read `AGENTS.md` and `docs/verification-policy.md`. Agree task IDs and keep one delivery branch.
2. Use `pnpm verify:change types`, then `pnpm verify:change lint` and `pnpm verify:change unit` with explicit existing files. For policy or receipt changes, run `pnpm verify:change tooling`.
3. For browser behavior use isolated fixtures and the relevant browser spec. Follow the test setup in `docs/ci.md`. Do not use production or another worktree's database.
4. Record task completion, integrate, rebase, and collect review evidence for the committed candidate. Use the guarded `pnpm verify:release` entry point only after the exact reviewed head is frozen and pushed. Never deploy or merge as part of verification.
