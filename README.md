# NabaLens

Private staff portfolios and an admin marketing media library for one organisation
with ten owner-confirmed venues. Staff upload to their own portfolio; admins see
the **same ready asset** centrally and download the unchanged original. There is
no editorial approval step or publishing tool. Exactly two roles: `staff` and
`admin`.

**Release status: NOT READY.** Local source/checks are not a hosted launch,
physical-phone certification or proof of publishing permission. See the
[release gates and two-venue pilot](docs/release-checklist.md).

## Start here

| You need to… | Read |
| --- | --- |
| Run locally, configure env or prepare staging/production | [Setup runbook](docs/setup.md) |
| Sign in, edit your profile, upload or remove your own media | [Staff guide](docs/usage-staff.md) |
| Filter/download originals, invite/manage/deactivate staff | [Admin guide](docs/usage-admin.md) |
| Handle capture safety, failed uploads, cleanup, retention or a lost phone | [Operations](docs/operations.md) |
| Decide whether staging, a two-venue pilot or production is allowed | [Release checklist](docs/release-checklist.md) |

## Local development

Use Node **24.16.0** and the team's approved **pnpm** (this pass used 10.30.1),
Docker and Supabase CLI (observed: 2.117.0). `package.json` has no Node/pnpm pin;
the lockfile has stricter requirements than Next's minimum. The
[prerequisites and dependency policy](docs/setup.md#1-prerequisites-and-dependency-policy)
explain exact versions, `minimumReleaseAge: 1440` and `allowBuilds` (including
the merged `esbuild: false` install-policy fix).

```sh
pnpm install --frozen-lockfile
```

**Shared Mac:** do not run bare `pnpm db:start` / `pnpm db:reset`.
The default project/554xx ports and the security/lifecycle helper stacks' fixed
ports may belong to another worktree. Follow the
[temporary owned-stack quick start](docs/setup.md#2-local-quick-start-without-colliding-with-another-worktree),
which copies the config, assigns a unique ID/unused ports and disables extra
services without committing config changes.

Then create your own ignored `.env.local` using `.env.example`, with your stack's
public URL/key, server-only service key, app origin and cleanup secret. Run:

```sh
pnpm dev --hostname 127.0.0.1 --port 3000
```

Match that port to your owned stack's Auth Site URL. Local sign-in uses Mailpit,
not real delivery. The local seed has explicitly labelled DEV FIXTURE accounts;
never load it into staging or production. Setup covers their identities, inbox
ports, first-admin bootstrap and **owner-confirmed-only** venue seeding.
`supabase/seed/venues.json` is intentionally empty until the owner supplies data.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm scan:bundle   # after build: client bundle secret scan
```

These do not need a Supabase stack. For `pnpm test:integration`,
`pnpm test:security "$W"`, `pnpm test:lifecycle "$W"`, `pnpm test:e2e` and
`pnpm test:migrations "$W" <phase>` ([backup and restore](docs/backup-restore.md)),
follow [isolated test setup](docs/setup.md#4-checks-and-isolated-test-stacks).
`bash scripts/ci/local-ci.sh` runs the whole fixture gate ([CI](docs/ci.md)).
Integration/e2e's bare-status fallback does not discover a temporary `$W`:
supply its explicit credentials privately. Tests write local test data.
E2e starts its own server (:3417 by default, `E2E_PORT` override); align Auth's
Site URL, install Chromium and do not run another dev server on that port.
Stop only the stack you own.

## Implementation reference

- Stack: Next **16.4.2** App Router (`proxy.ts`), React **19.3.1**,
  TypeScript **5.9.3**, Tailwind **4.3.3** + shadcn/Base UI,
  Supabase Auth/Postgres/private Storage via `@supabase/ssr`.
- Routes: `/login`, `/staff`, `/admin`, `/admin/staff`,
  `/admin/staff/[id]`. Auth email templates use `/auth/confirm`;
  `/auth/callback` supports PKCE fallback.
- Limits in `lib/config/media.ts`: 10 files/batch, 2 parallel transfers,
  20 MiB photos, 200 MiB videos, 5 MiB avatar inputs, 60-second signed reads,
  24-hour abandoned-upload window. Provider/plan caps still need verification.
- [Architecture/security boundaries](docs/architecture.md)
- [Media pipeline and HEIC deployment constraints](docs/media-pipeline.md)
- [Upload transport](docs/upload-transport.md)
- [Removal and cleanup](docs/cleanup.md)
- [Security tests](docs/security-tests.md)
- [Privacy audit](docs/privacy-audit.md) and [backup/restore drill](docs/backup-restore.md)
- [CI gate](docs/ci.md) and [acceptance map](docs/acceptance.md)
- Reviews: [wave 3](docs/reviews/wave3-review.md),
  [upload path](docs/reviews/upload-path-review.md), [scope](docs/reviews/scope-audit.md)
- [Product specification v0.2](docs/spec/NabaLens-MVP-Execution-v0.2.md)
- [Coding-agent brief](docs/spec/NabaLens-Coding-Agent-Prompt.md)
- [Parallel-build ownership/limits](docs/fanout/CONTRACT.md)

No hosted provider writes, secret/DNS changes, database push or deployment is
authorised by these docs. Complete each **NOT DONE, requires owner authorisation**
item in the setup runbook before release.
