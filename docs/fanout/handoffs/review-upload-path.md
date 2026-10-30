# Handoff: review-upload-path (integrated upload path review)

Goal: independent review of the integrated upload path on `feat/nabalens-mvp` @ 3a23c9b.
Deliverable: `docs/reviews/upload-path-review.md` (only file besides this handoff to commit).
No application code changes.

## Done
- Read server path: reserve.ts, finalise.ts, storage.ts, access.ts, routes, migrations, lifecycle cleanup/remove.
- Isolated stack prepared at /tmp/nl-uppath2-stack (project_id nabalens-uppath2, ports 600xx,
  studio/realtime/analytics/edge/smtp/vector/s3 disabled).

## In progress
- Repro tests (uncommitted scratch): tests/security/upload-path-review.repro.test.ts
  + tests/security/upload-path-review.vitest.config.ts

## How to run the stack
    W=/tmp/nl-uppath2-stack
    node tests/security/prepare-stack.mjs $W   # then edit project_id/ports/services as above
    supabase --workdir $W start -x vector,logflare,imgproxy,studio,mailpit,realtime,edge-runtime,postgres-meta,supavisor
    # env from `supabase --workdir $W status -o json` -> NEXT_PUBLIC_SUPABASE_URL etc.
    supabase --workdir $W stop   # when done

## Next steps
- Run repros, write review doc, stop stack.

## Open questions
- none yet
