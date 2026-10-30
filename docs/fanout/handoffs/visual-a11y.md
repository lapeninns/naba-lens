# Handoff: visual-a11y track (`feat/nl-visual`)

## Goal

Spec §4 visual/accessibility pass on the REAL app (production build, isolated stack, DEV
FIXTURE data): inspect every screen and dialog at 360/390/768/1280/1440 in Chromium plus
Firefox and WebKit at 1280; axe with zero serious/critical; fix defects without redesign;
commit a reproducible `tests/e2e/visual.spec.ts`.

## How to run

```sh
W=$(node tests/visual/prepare-stack.mjs)        # project nabalens-visual, ports 577xx,
supabase --workdir "$W" start                   # studio/realtime/analytics/edge off
pnpm test:visual "$W"                           # next build + next start :3517 + playwright
pnpm test:visual "$W" --no-build --project chromium
supabase --workdir "$W" stop                    # when finished
```

Screenshots: `.artifacts/screenshots/visual/<project>/<screen>-<light|dark>-<width>.png`
(gitignored). Fixtures: `tests/visual/fixtures.ts`, seeded once per run and cached in
`$TMPDIR/nabalens-visual-fixtures-<hash>-<ppid>.json`.

## Files

- `tests/e2e/visual.spec.ts`, `tests/visual/{fixtures.ts,prepare-stack.mjs,run.mjs}`,
  `playwright.visual.config.ts`, `package.json` (`test:visual`, `@axe-core/playwright`).
- Fixes: see the defect table in the final handoff / commit log.

## Status

See the bottom of this file (updated as work progresses).

## Notes

- The machine runs ~13 Supabase stacks; local auth sometimes answers 504 "please
  retry". Fixture steps (`createUser`, `generateLink`) retry only that status, like
  `tests/e2e/slice.spec.ts`. No assertion is retried.
- The spec lives in `tests/e2e` but skips itself unless `NABALENS_VISUAL` is set, which
  `playwright.visual.config.ts` does; `pnpm test:e2e` (next dev) reports it as skipped.
