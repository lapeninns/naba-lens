# Handoff: review-wave3 (independent security/correctness review)

- Goal: review `git diff 4918867..078b60a` (feat/nabalens-mvp) against docs/spec and
  docs/fanout/CONTRACT.md. No application code changes.
- Branch: `review/nl-wave3`.
- Status: DONE. Findings and verdict are in `docs/reviews/wave3-review.md`.
- Stack: `/tmp/nl-wave3-review` (project `nabalens-w3review`, ports 593xx). Stopped.
  To reproduce: `supabase --workdir /tmp/nl-wave3-review start`, then
  `node /tmp/nl-w3-probes/probe{1,2,3}.mjs` with SB_URL/SB_ANON/SB_SR from
  `supabase --workdir /tmp/nl-wave3-review status -o env`. Probes are not committed.
- Open questions: is Supabase TUS RLS checked when an upload completes (relevant to the
  finding 4 fix)? Not verified.
