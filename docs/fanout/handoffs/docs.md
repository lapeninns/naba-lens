# Docs track handoff

Goal: document actual setup, use, operations and release gates.

Done: five requested guides and README links; no application changes. Production items explicitly NOT DONE and require owner authorisation.

In progress: none. Next: resolve repository pnpm build-approval policy, rerun required checks, then integrator review. No stack started; follow docs/setup.md for an isolated temporary config and unused ports. No provider writes.

Open questions: confirmed venues, production email/hosting, physical-phone and deployed HEIC evidence.

Verification output (actual):

```text
pnpm install --frozen-lockfile
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2
```

Required command logs:

### pnpm typecheck

```text
✓ Lockfile passes supply-chain policies (verified 48m ago)
Lockfile is up to date, resolution step is skipped
Already up to date

[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
[ERROR] Command failed with exit code 1: pnpm install

pnpm: Command failed with exit code 1: pnpm install
    at getFinalError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:88203:14)
    at makeError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:90510:21)
    at getSyncResult (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92354:10)
    at spawnSubprocessSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92314:14)
    at execaCoreSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92244:23)
    at callBoundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94772:23)
    at boundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94749:49)
    at sync2 (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94904:14)
    at runPnpmCli (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:249523:5)
    at runDepsStatusCheck (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:251287:7)
```

### pnpm lint

```text
✓ Lockfile passes supply-chain policies (verified 48m ago)
Lockfile is up to date, resolution step is skipped
Already up to date

[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
[ERROR] Command failed with exit code 1: pnpm install

pnpm: Command failed with exit code 1: pnpm install
    at getFinalError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:88203:14)
    at makeError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:90510:21)
    at getSyncResult (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92354:10)
    at spawnSubprocessSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92314:14)
    at execaCoreSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92244:23)
    at callBoundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94772:23)
    at boundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94749:49)
    at sync2 (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94904:14)
    at runPnpmCli (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:249523:5)
    at runDepsStatusCheck (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:251287:7)
```

### pnpm test

```text
✓ Lockfile passes supply-chain policies (verified 48m ago)
Lockfile is up to date, resolution step is skipped
Already up to date

[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
[ERROR] Command failed with exit code 1: pnpm install

pnpm: Command failed with exit code 1: pnpm install
    at getFinalError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:88203:14)
    at makeError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:90510:21)
    at getSyncResult (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92354:10)
    at spawnSubprocessSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92314:14)
    at execaCoreSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92244:23)
    at callBoundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94772:23)
    at boundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94749:49)
    at sync2 (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94904:14)
    at runPnpmCli (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:249523:5)
    at runDepsStatusCheck (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:251287:7)
```

### pnpm build

```text
✓ Lockfile passes supply-chain policies (verified 48m ago)
Lockfile is up to date, resolution step is skipped
Already up to date

[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
[ERROR] Command failed with exit code 1: pnpm install

pnpm: Command failed with exit code 1: pnpm install
    at getFinalError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:88203:14)
    at makeError (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:90510:21)
    at getSyncResult (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92354:10)
    at spawnSubprocessSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92314:14)
    at execaCoreSync (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:92244:23)
    at callBoundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94772:23)
    at boundExeca (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94749:49)
    at sync2 (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:94904:14)
    at runPnpmCli (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:249523:5)
    at runDepsStatusCheck (file:///Users/amankumarshrestha/.local/lib/node_modules/pnpm/dist/pnpm.mjs:251287:7)
```
