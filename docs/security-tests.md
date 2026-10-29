# NabaLens negative-access integration report

Security track, branch `feat/nl-security`, foundation baseline; local execution only.

## Result

The adversarial suite passed **114 tests in one file** against the isolated
`nabalens-security` Supabase stack at `http://127.0.0.1:56421` (DB 56422).
The foundation stack on 554xx was not used. No access-control bypass was
reproduced; **no policy fixes or new migrations were necessary**.

| Spec rule / attack coverage | Identities exercised | Result | Fixed |
| --- | --- | --- | --- |
| §7 profiles list and targeted select: staff sees own profile; admin sees all; inactive sees only own explanatory row | All seven | Passed | None |
| §7 venues list/select requires active profile; direct update/delete prohibited | All seven | Passed | None |
| §7 media list/select: own live rows for staff; ready live rows for admin; deleted hidden | All seven, all four asset states | Passed | None |
| §7 direct media INSERT, UPDATE uploader_id/venue_id/original_path/upload_state/deleted_at, DELETE prohibited; persisted row unchanged | All seven | Passed | None |
| §7 profile role escalation and direct deletion prohibited | All seven | Passed | None |
| §7 staff/inactive/anonymous cannot change active, venue_id or job_title; cross-user display-name changes blocked | Six non-active-admin identities; same-venue B and other-venue C | Passed | None |
| §7 positive controls: own display-name update, admin job-title/venue/activation update; foreign avatar_path rejected | A, B, admin | Passed | None |
| §7/§10 storage list/download/sign requires ready non-deleted asset and owner or active admin; signed download preserves fixture bytes | All seven × uploading/failed/ready/deleted | Passed | None |
| §7 storage PUT overwrite and upsert overwrite blocked; unreserved, foreign, derivative and unexpected filenames blocked | All seven | Passed | None |
| §7 failed/deleted reservations reject fresh original uploads with no existing object (avoids relying on duplicate-key denial) | A | Passed | None |
| §7 avatar list/download/sign allows only owner or active admin; own/foreign avatar upload, overwrite and upsert prohibited | All seven | Passed | None |
| §7 reservation requires active staff, derives owner/current venue; fresh reserved upload allowed; deletion requires active owner or admin | All seven | Passed | None |
| §7 service-only cleanup RPC inaccessible | All seven | Passed | None |
| §7/§10 password signUp and unknown-email OTP (default and explicit account creation) create neither account nor session | Anonymous | Passed | None |

The seven callers are staff A, staff B initially at A's venue, staff C at another
venue, admin, inactive staff, inactive admin, and anonymous. Each authenticated
caller has a distinct real Auth-issued JWT; inactive callers are deactivated
**after issuance** and continue using the same token. B's later admin-driven venue
change happens after the same-venue isolation matrix. API assertions use the anon
key and raw PostgREST, Storage and Auth HTTP requests. Service-role calls are
limited to fixture provisioning and independent persisted-state readback, not
attacker assertions. Existing foundation helpers are reused for fixtures.

## Reproduction and actual output

Start an isolated local Supabase workdir with this checkout's migrations, private
buckets and signup-disabled Auth config. Do not start this checkout's committed
554xx configuration: it belongs to foundation. Pass that isolated workdir explicitly:

```sh
node tests/security/run.mjs /absolute/path/to/isolated-workdir
```

The runner captures `supabase --workdir ... status -o json` privately and passes
credentials only through the child process environment. It refuses remote hosts
and foundation's 554xx API ports. No credentials are printed or checked in.
The Vitest config lives inside track ownership and does not alter the shared test
harness. Default `pnpm test` does not include this suite.

Actual final runner invocation in this workspace:

```sh
node tests/security/run.mjs "$(cat /tmp/nl-security-workdir)"
```

```text
Test Files  1 passed (1)
     Tests  114 passed (114)
```

TypeScript and targeted ESLint validation also completed successfully:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js tests/security
```

An intermediate expanded run had four failures because its generic HTTP helper
rejected all 500 responses. The existing delete RPC deliberately raises SQLSTATE
`P0002` / `media_asset_not_found` for forbidden callers; PostgREST maps that error
to HTTP 500. The assertion now accepts only this exact documented denial on that
RPC, while rejecting other server failures. This was a test transport assumption,
not an access-policy fix. Forbidden deletion's unchanged persisted tombstone is
also checked.

## Scope and limits

This is deterministic database/Auth/Storage boundary testing; it has no applicable
browser/mobile user journey, so the e2e agent runner is not applicable to this
track's suite. It does not certify UI flows, route-handler authorisation, physical
phones, byte validation, email delivery, deployed configuration or hosted policy
parity. Existing foundation integration tests remain separate and must also run.
Public account creation protection is tested against the local Auth configuration,
not a hosted project. Previously issued signed links and downloaded copies are
not claimed to be recalled by deletion or deactivation.

Fixtures are clearly labelled TEST, unique per run, and remain only in this
isolated local database. The suite never resets databases or stops containers.
`docs/security-tests.md` is the user-requested small ownership exception; all
implementation files are under `tests/security/`. No existing migrations,
shared harness files, application code or committed Supabase configuration changed.
