# Handoff: final fix, a11y regression (`feat/nl-fix-a11y`)

## Goal

The final CI reproduction (`review-nl-final-ci`) failed `tests/e2e/responsive.spec.ts:145`,
`admin-row-actions-menu@360: axe serious/critical` = `aria-hidden-focus`. Find the root
cause, fix it without suppressing the rule, prove it with 3 consecutive passes of
`responsive.spec.ts` (Chromium) and `pnpm test:visual` at 360/390.

## Root cause

- The flagged nodes, extracted from the CI trace (`test-results/responsive-screens-and-dialogs-at-360px-chromium/trace.zip`
  in `review-nl-final-ci`), are six Base UI focus guards:
  `<span aria-hidden="true" tabindex="0" data-base-ui-focus-guard style="…width:1px;height:1px…">`.
  Two sit beside the menu trigger, two are portal "outside" guards and two are "inside" guards.
  Message: "Focusable content should have tabindex=-1, be removed from the DOM, or not be hidden with aria-hidden".
- The same guards exist in every run whenever a Base UI menu, select, popover or dialog is
  open. axe only excuses them when `isModalOpen()` returns true. That heuristic samples five
  points (inset 12.5% of the viewport) for one full-screen fixed layer. Base UI's menu
  backdrop (`InternalBackdrop`) cuts a clip-path hole over the trigger. When the trigger
  covers a sample point, `elementsFromPoint` misses the backdrop at that point, the
  heuristic returns false and the guards become violations.
- In the CI run the directory held 134 accounts, accumulated by the earlier specs. The
  full-page screenshot shows Staff A's trigger at about (315, 700), which is the sample point
  (0.875 × 360, 0.875 × 800). So nothing in d82ae9f/ab41734 or the auth-edges merges caused
  it. The defect was latent, and the data volume at that moment decided the outcome.
- Reproduced deterministically by pinning the trigger centre on that point: same six nodes.

## Fix

- `app/globals.css` (ui-owned, a tiny out-of-track change): `[data-base-ui-focus-guard][aria-hidden="true"]`
  is now 0×0 with `pointer-events: none` (`!important` beats Base UI's inline style). This is
  how Radix guards are built. The guard is still focusable from the keyboard, and axe's
  `focusable-not-tabbable` check classifies it as a focus sentinel (needs review), not a
  failure. The rule is not disabled, filtered or excluded. VoiceOver guards (`role="button"`,
  no aria-hidden) keep their 1px box.
- `tests/e2e/responsive.spec.ts`:
  - New test `row actions menu: axe holds wherever the trigger sits; guards still move focus`.
    At 360×800 it puts the trigger centre on axe's sample point, opens the menu and expects
    zero serious/critical violations. It then checks that Tab out of the menu closes it and
    lands on a real element, and that the invite dialog keeps focus trapped for 12× Tab and
    12× Shift+Tab without focus resting on a guard.
  - Pre-existing flake, also seen on the unfixed tree (1 of 4 full runs): the keyboard-only
    test tabbed before Base UI moved initial focus into the dialog on the next frame. It now
    polls until focus is inside the dialog or viewer before tabbing. The assertions are
    unchanged and there are no retries.

## Also fixed: review finding F3

`tests/e2e/visual.spec.ts` `signIn` opened `/auth/confirm?...` and never pressed Continue on
the new interstitial, so every signed-in visual test stayed on `/auth/confirm`. It now calls
`openEmailLink` from `tests/e2e/helpers/email-link.ts`.

`feat/nabalens-mvp` @ 2471677 (privacy fix) is merged into this branch, with no conflicts.

## Evidence (isolated stack `nl-fix-a11y`, ports 592xx, app :3561)

- New test without the CSS fix: FAILED with `aria-hidden-focus: <span aria-hidden="true" tabindex="0" data-base-ui-focus-guard …>` (the CI nodes).
  With the fix: passed.
- `responsive.spec.ts --project chromium`, 3 consecutive full runs after both commits: 7 passed, 7 passed, 7 passed.
- On the merged head (after the 2471677 merge):
  - `responsive.spec.ts --project chromium`: 3 consecutive full runs, 7 passed each.
  - `pnpm test:visual $W --no-build --project chromium --project webkit` (fresh `next build`
    just before, by the runner): **30 passed (5.4m)**. Chromium covers 360/390/768/1280/1440;
    WebKit covers 1280.
  - `pnpm typecheck` exit 0, `pnpm lint` clean, `pnpm test` 21 files / 153 passed, `pnpm build` compiled.
- Firefox for the visual suite was not run (the visual-a11y handoff records it as blocked locally).

## How to run the stack

```sh
W=/tmp/nl-fixa11y-stack
E2E_PORT=3561 E2E_PORT_BLOCK=592 node tests/e2e/prepare-stack.mjs $W
sed -i '' 's/^project_id = .*/project_id = "nl-fix-a11y"/' $W/supabase/config.toml
supabase --workdir $W start
E2E_PORT=3561 E2E_SUPABASE_WORKDIR=$W pnpm exec playwright test tests/e2e/responsive.spec.ts --project chromium
VISUAL_PORT=3562 pnpm test:visual $W --no-build --project chromium
supabase --workdir $W stop
```

## Open questions

- The same latent exposure applies to every Base UI floating component (the venue filter
  select, dialogs). The global CSS rule covers them all.
- An upstream Base UI issue may be worth filing: guards that are 1px and take pointer events read as focusable hidden content.
