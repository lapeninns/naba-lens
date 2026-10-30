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

## Status (30 Oct 2026): done

- `pnpm test:visual "$W" --project chromium --project webkit`: 28 passed (Chromium at
  360/390/768/1280/1440, WebKit at 1280, light + dark).
- Firefox: **blocked**. Every cached Playwright Firefox build (1538, 1543, 1555) exits
  at launch with "Could not find profile folder", inside and outside the sandbox. This
  is not an app failure, but Firefox is unverified.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (102/102) and `pnpm build` pass.

## Defects fixed

| # | Defect (evidence before) | Fix | Evidence after |
|---|---|---|---|
| 1 | Dialog close (X) 28×28 on phones | `components/ui/dialog.tsx`: 44px below `sm` | `upload-dialog-light-360.png` |
| 2 | Library filter selects 32px tall (`data-[size=default]:h-8` beat `h-11`) | `option-select.tsx`: same-specificity override | `admin-library-light-360.png` |
| 3 | Select options 36px tall on phones | `option-select.tsx`: `min-h-11 sm:min-h-0` | `admin-filter-venue-open-light-360.png` |
| 4 | Row-action menu items 28px tall on phones | `ui/dropdown-menu.tsx` item `min-h-11 sm:min-h-0` | `admin-staff-menu-light-360.png` |
| 5 | Switch hit area 34px tall | `ui/switch.tsx` `::after` −3.5 on phones | `admin-edit-staff-light-360.png` |
| 6 | `/auth/blocked` Sign out button 32px tall | `app/auth/sign-out-button.tsx` `size="touch"` (presentational, foundation file) | `blocked-light-360.png` |
| 7 | axe `label-content-name-mismatch`: video tile badge "0:12" missing from the name | `media-tile.tsx` adds the duration to the name | `staff-populated-*.png` |
| 8 | axe `label-content-name-mismatch`: phone directory rows had `aria-label` without the job title/venue | `staff-directory-table.tsx`: name from the content plus sr-only ", open portfolio" | `admin-staff-light-360.png` |
| 9 | Admin "Edit staff account" (and invite) form wider than the 360/390/768 viewport with a long venue name; Save cut off | forms `grid-cols-[minmax(0,1fr)] min-w-0`, select `min-w-0` | `admin-edit-staff-light-360.png` |
| 10 | Profile name truncated with an ellipsis on phones (own name hidden) | `profile-header.tsx` wraps (`break-words`) | `staff-long-name-light-360.png` |
| 11 | Viewer Delete/Download scrolled below a tall preview (phones and 1280×800) | `media-viewer.tsx` sticky footer | `viewer-photo-portrait-light-360.png` |
| 12 | Dark mode: destructive text 4.43:1 on its tint (axe color-contrast) | `globals.css` dark `--destructive` 0.70→0.73 L | `viewer-photo-landscape-dark-390.png` |

| 13 | Viewer pre-rejected video by `canPlayType` (Chromium returns "" for `video/quicktime`), so an H.264 MOV showed "Preview unavailable" without trying (found by the uploads track) | `media-viewer.tsx`: no pre-check and no `<source type>`; `<video src>` reads the real bytes, and a decode failure fires `error` on the `<video>`, which shows the fallback. Still no autoplay | `viewer-video-mov-light-1280.png`, `viewer-video-hevc-fallback-light-390.png` |

The codec test `staff: video playback by codec` checks that an H.264 MOV **plays** in
Chromium and WebKit. It checks that an HEVC MP4 shows the **fallback** in Chromium and
**plays** in WebKit. Unit tests in `tests/ui/components.test.tsx` cover the same
behaviour. As a negative control, the old viewer fails the test: Expected "plays",
Received "fallback". The HEVC MP4 fixture (`tests/visual/media/hevc.mp4`, 3.5 KB of
synthetic frames) is a stream copy of `tests/fixtures/media/review-hevc.mov`.

Re-run on 30 Oct 2026 after the fix: Chromium + WebKit 30 passed; `pnpm test` 103 passed;
typecheck, lint and build pass.

### Cosmetic fixes from the journey QA report (`feat/nl-journey:docs/qa-report.md`)

| Defect | Fix | Evidence |
|---|---|---|
| Staff filter value cut mid-character at 768 px | `option-select.tsx`: the value is `block truncate` at the trigger's specificity, so it ends with an ellipsis (asserted in the spec) | `admin-filter-empty-light-768.png` |
| Expired-link alert body squeezed into a narrow column at 360 px | `login-card.tsx`: `text-pretty` instead of the kit's `text-balance` | `login-expired-light-360.png` |
| Avatar file input looked like a bare native control | `edit-profile-dialog.tsx`: styled "Choose File" button inside the field | `admin-edit-staff-light-390.png` |
| Video tiles without a poster showed the photo icon | `media-tile.tsx`: film-strip icon for videos (no poster frames: no transcoding in the MVP) | `staff-populated-light-390.png` |
| Sub-second clips showed "0:00" | `format.ts`: `formatDuration` returns "<0:01" (unit + e2e asserted) | `staff-populated-light-390.png` |

**Merge coordination:** `media-tile.tsx` and `staff-directory-table.tsx` now carry
`feat/nl-journey`'s exact label-in-name fixes. The tile name ends with `duration m:ss`, and
the row link names itself from its content plus a screen-reader-only ", open portfolio".
My earlier variant is gone, so the merge cannot add a second duration. On this branch,
the only remaining difference from journey's `media-tile.tsx` is the film-strip icon.

Re-run after these fixes: Chromium + WebKit 30 passed; `pnpm test` 104 passed;
typecheck, lint and build pass.

## Known upstream exception

WebKit only: Base UI renders each modal's hidden focus-trap sentinels as unnamed
`span[role=button][data-base-ui-focus-guard]`, which axe reports as `aria-command-name`
(serious). The spec exempts exactly those nodes for that rule and records an
`axe-upstream-exempt` annotation. Other nodes still fail. To fix it upstream, raise it
with Base UI, or patch it once the library offers an option.

## Notes

- The machine runs ~13 Supabase stacks; local auth sometimes answers 504 "please
  retry". Fixture steps (`createUser`, `generateLink`) retry only that status, like
  `tests/e2e/slice.spec.ts`. No assertion is retried.
- The spec lives in `tests/e2e` but skips itself unless `NABALENS_VISUAL` is set, which
  `playwright.visual.config.ts` does; `pnpm test:e2e` (next dev) reports it as skipped.
