# Handoff: review-wave3 (independent security/correctness review)

- Goal: review `git diff 4918867..078b60a` (feat/nabalens-mvp) against docs/spec and
  docs/fanout/CONTRACT.md; write ranked findings to `docs/reviews/wave3-review.md`.
  No application code changes.
- Branch: `review/nl-wave3` (worktree ~/.t3/worktrees/nabalens/review-nl-wave3).
- Stack: `/tmp/nl-wave3-review` (copy of supabase/ via tests/security/prepare-stack.mjs,
  project_id `nabalens-w3review`, ports 593xx, studio/realtime/analytics/edge_runtime off).
  Start: `supabase --workdir /tmp/nl-wave3-review start`; stop:
  `supabase --workdir /tmp/nl-wave3-review stop`.
- Probe scripts: /tmp/nl-w3-probes (not committed).
- Done: read migrations, lib/server/{media,accounts,lifecycle}, routes, proxy, auth.
- In progress: verifying suspicions on the stack; writing the review.
- Next: finish review doc, commit, stop the stack.
