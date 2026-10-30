# CI track continuity

Goal: reproducible fixture-only GitHub and local CI.

Done: workflow matrix and protected staging blueprint (0497247); CI-owned local
stack preparation, suite runner and cross-browser Playwright wrapper implemented.
No shared harness or Supabase source config modified. No remote, push or lci.

In progress: pinned local end-to-end gate, logs /tmp/nabalens-ci-pinned.log;
stack workdir recorded in final command output. Initial pnpm 11 attempt failed
because esbuild approval is missing; pnpm 10.30.1 frozen install passes.
Typecheck and lint passed so far. Unit/build/database/browser results pending.

Run: pnpm 10.30.1 on PATH; bash scripts/ci/local-ci.sh. Requires Docker,
Supabase CLI 2.117.0 and pnpm exec playwright install chromium (or CI_BROWSER).
Temporary stack has unique project ID and probed port block, optional services
are disabled; EXIT trap stops only owned stack with --no-backup.

Next: finish execution, record exact outcome and commit final evidence.
Open questions: staging does not exist; protected manual job is documented only.
Agentic e2e runner is not installed on PATH; no agentic execution claimed.
