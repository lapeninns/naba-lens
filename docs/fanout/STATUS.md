# NabaLens fan-out status

Integration branch: `feat/nabalens-mvp`. Updated 29 October 2026 by the integrator.

## Merged

| Branch               | Tip       | Merge commit | Notes                                                                                  |
| -------------------- | --------- | ------------ | -------------------------------------------------------------------------------------- |
| `feat/nl-foundation` | `da34c62` | `33e16e0`    | M0 + M1: schema, RLS, storage, auth, `proxy.ts`, test harness. Lockfile-only conflict. |
| `feat/nl-ui`         | `d9a42c2` | `0203513`    | Theme, shadcn kit, `components/nabalens/**`, `/ui-preview` (404 in production).        |

Integration changes made during the merges:

- **Lockfile.** Both merges were re-resolved from the `minimumReleaseAge: 1440` base
  (`635f8d8`) rather than taking either branch's lockfile. New dependencies resolved to the
  same versions the branches used. `pnpm install --frozen-lockfile` passes with pnpm 10.30.1,
  and pnpm 11.17.0 passes too ("Lockfile passes supply-chain policies", 731 entries), checked
  in a scratch copy because pnpm 11 wants to rebuild `node_modules`. The policy was not relaxed.
- **Test harness.** One `vitest.config.ts`, foundation's. The `unit` project now also includes
  `tests/ui/**/*.test.{ts,tsx}`; component tests opt into jsdom per file. `pnpm test` runs both
  foundation's and the UI's tests. The UI branch's minimal config was dropped.
- **`/login`** renders the UI kit's `LoginCard`. `app/login/actions.ts` exposes
  `requestSignInLink(email) -> { error? }`; `app/login/login-form.tsx` was removed. The e2e
  selectors follow the new copy ("Email", "sign-in link has expired").
- **`MEDIA_LIMITS.maxFilesPerBatch` was renamed to `maxBatchFiles`**, the name the UI kit and the
  media branch use. A type test (`tests/unit/media-config.test.ts`) asserts that `MEDIA_LIMITS`
  satisfies the UI's `UploadLimits`, so `UploadDialog limits={MEDIA_LIMITS}` compiles.
- `app/layout.tsx` uses the UI's Geist fonts; `--font-heading` maps to the sans font, so
  foundation's `font-heading` pages still render.
- The `feat/nl-foundation` and `feat/nl-ui` worktrees were clean and have been removed. Their
  branches are kept.

## Checks on `feat/nabalens-mvp` (after `supabase db reset`)

| Command                                         | Result                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (pnpm 10 / 11) | pass / pass (supply-chain policy check)                                      |
| `pnpm typecheck`                                | pass, no errors                                                              |
| `pnpm lint`                                     | pass, no errors                                                              |
| `pnpm test`                                     | 5 files, 35 tests passed (foundation unit + UI + type)                       |
| `pnpm test:integration`                         | 4 files, 33 tests passed (local stack, ports 554xx)                          |
| `pnpm test:e2e`                                 | 12 passed (mobile + desktop, real magic link via Mailpit)                    |
| `pnpm build`                                    | compiled; routes `/`, `/admin`, `/auth/*`, `/login`, `/staff`, `/ui-preview` |

The local stack is project `nabalens` (API `:55421`, DB `:55422`, Studio `:55423`, Mailpit
`:55424`). It was reused, not restarted, and reset from this checkout. A separate
`nabalens-security` stack (564xx) belongs to another track and was not touched.

## Security check: public sign-up

Config: `[auth] enable_signup = false`, `[auth.email] enable_signup = true`. The running auth
container has `GOTRUE_DISABLE_SIGNUP=true` and `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`.

Raw HTTP probe with the publishable key against `:55421`, using a fresh `probe-*@nabalens.test`:

| Request                                  | Response                                    |
| ---------------------------------------- | ------------------------------------------- |
| `POST /auth/v1/signup` (email+password)  | 422 `signup_disabled`                       |
| `POST /auth/v1/otp` `create_user: true`  | 422 `signup_disabled`                       |
| `POST /auth/v1/otp` `create_user: false` | 422 `otp_disabled` (app shows neutral copy) |
| Admin user list, filtered to that email  | 0 users                                     |

`tests/integration/accounts.test.ts` asserts the same through supabase-js, and the e2e
magic-link sign-in for an invited user passes. **No config change was needed.** Keep
`[auth.email] enable_signup = true`: in the Supabase CLI it enables the whole email provider,
and turning it off breaks magic links. The app-level gate is `[auth] enable_signup = false`.
For hosted Supabase, the matching settings are "Allow new users to sign up" off and the Email
provider on. Check them at release (M6).

## Not merged yet

- `feat/nl-media` (worktree active). **Expect conflicts** in `lib/config/media.ts`,
  `vitest.config.ts`, `package.json` and `pnpm-lock.yaml`. Its `MEDIA_LIMITS` uses different
  names from foundation's for two fields: `signedUrlTtlSeconds` (foundation:
  `signedUrlExpirySeconds`) and `abandonedUploadHours` (foundation: `abandonedUploadWindowHours`,
  used by `abandonedUploadInterval()`). It also drops foundation's `MediaLimits` type,
  `maxBytesFor` and `abandonedUploadInterval`. Merge plan: keep foundation's file and add the
  media processing fields. Pick one name for each of the two fields and update the callers.
  `maxBatchFiles` already matches.
- `feat/nl-transport` (worktree active). Expect conflicts in `package.json` and `pnpm-lock.yaml`
  only. Re-resolve the lockfile from this branch, as above.
- `feat/nl-security` (based on `da34c62`) adds `tests/security/vitest.config.ts`. Fold it into
  the root config as a project rather than keeping a second config.

## Open gaps for the next wave

- **No real pages yet.** `/staff` and `/admin` are foundation placeholders. Wave 2 (slice,
  accounts) wires `AppShell`, `MediaGrid`, `UploadDialog` and the other components to data.
  `components/nabalens` must stay free of `lib/supabase` imports.
- **No upload routes or `Uploader`.** The UI's `UploadDialog` needs a page-supplied
  `Uploader(file, ctx)`. The reserve/finalise routes must check `MEDIA_LIMITS` before calling
  `reserve_media_asset`, because that function does not check sizes. Only sign keys that it
  returned.
- **No cleanup worker.** `prepare_media_cleanup` exists, but nothing schedules it.
- **No avatar processing, invitations or account management** (accounts track).
- **`LoginCard` sent-state copy** says "Open it on this device". Foundation's `token_hash`
  links also work in another browser, so the copy is stricter than needed but harmless. The UI
  track owns it.
- **`next dev` warning (seen in the e2e web server):** "Next.js ignored pnpm-workspace.yaml in /Users/amankumarshrestha".
  This comes from a stray workspace file in the home directory, outside the repo. It is not a
  repo issue.
- Not verified: physical phones (camera, HEIC), hosted Supabase, SMTP. These are release items.
