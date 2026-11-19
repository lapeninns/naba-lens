# Upload-path review handoff

- Goal: independently review the integrated upload path at `3a23c9bf065a5e7d369a7bdac0006e5c38a0dfbd`; application code stays unchanged. Commit only `docs/reviews/upload-path-review.md`.
- Done: confirmed HEAD and `feat/nabalens-mvp` match the target; read reserve/finalise/storage adapter and media validation. Assigned independent read-only transport/storage and download/deletion reviews.
- In progress: prepare one isolated stack and executable adversarial reproductions. Existing unrelated stacks will not be touched.
- Stack workdir: `/private/tmp/nabalens-upload-path-review-3a23c9b`; project `nabalens-upload-path-review`; ports `596xx`. Prepared using `tests/security/prepare-stack.mjs`, with studio, realtime, analytics, edge runtime disabled.
- Run: `supabase --workdir /private/tmp/nabalens-upload-path-review-3a23c9b start`; baseline: `pnpm test:security /private/tmp/nabalens-upload-path-review-3a23c9b`; stop: `supabase --workdir /private/tmp/nabalens-upload-path-review-3a23c9b stop`.
- Next exact steps: inspect SQL policies and lifecycle transitions; prove storage-key binding/immutability, actual versus reserved size, finalise concurrency, cleanup races, MIME headers and TUS authorization on the isolated stack; write ranked findings and negative controls; stop stack; commit report only.
- Open questions: whether upload tokens bypass later reservation state changes; whether stale processing takeover is fenced; whether deletion can race the final ready update. Candidates are not yet confirmed.
- Continuity: this handoff stays uncommitted to honor the explicit “commit only that file” constraint. Put verified milestones in the review report and commit it at green milestones / about every 30 minutes.
