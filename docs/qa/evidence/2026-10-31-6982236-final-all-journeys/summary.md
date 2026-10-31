# Journey run 20261031T153532Z-6982236

- Commit: `6982236f78c29327d2008366ba1ec91500e028ef` on `ws1/evidence`
- Stack: `ws1` (API port 64121, migrations 20261030160000:cee297c7)
- Started 2026-10-31T15:35:32.773Z, finished 2026-10-31T15:41:47.445Z
- Totals: 32 pass, 2 fail, 0 unavailable
- Exit code: 1

| Journey | Result | Reason | Evidence |
| --- | --- | --- | --- |
| `auth.login-smoke` | PASS |  | `logs/auth.login-smoke.log`<br>`shots/auth.login-smoke/01-staff-a-portfolio.png` |
| `media.leave-warning` | PASS |  | `logs/media.leave-warning.log` |
| `media.partial-batch` | PASS |  | `logs/media.partial-batch.log` |
| `media.reload-metadata` | PASS |  | `logs/media.reload-metadata.log`<br>`shots/media.reload-metadata/01-staff-portfolio.png`<br>`shots/media.reload-metadata/02-admin-library.png` |
| `media.reload-resume` | PASS |  | `logs/media.reload-resume.log` |
| `media.removed-reservation` | PASS |  | `logs/media.removed-reservation.log` |
| `media.reopen-states` | PASS |  | `logs/media.reopen-states.log`<br>`shots/media.reopen-states/01-portfolio-after-reload.png` |
| `media.slice-profile-photo-mobile` | PASS |  | `logs/media.slice-profile-photo-mobile.log` |
| `media.slice-profile-photo` | PASS |  | `logs/media.slice-profile-photo.log` |
| `media.slice-staff-upload-mobile` | PASS |  | `logs/media.slice-staff-upload-mobile.log` |
| `media.slice-staff-upload` | PASS |  | `logs/media.slice-staff-upload.log` |
| `media.stuck-processing` | PASS |  | `logs/media.stuck-processing.log`<br>`shots/media.stuck-processing/01-stuck-processing.png` |
| `media.tus-interrupted-resume` | PASS |  | `logs/media.tus-interrupted-resume.log` |
| `media.tus-offline-retry` | PASS |  | `logs/media.tus-offline-retry.log`<br>`shots/media.tus-offline-retry/01-offline-failed.png`<br>`shots/media.tus-offline-retry/02-offline-failed.png` |
| `menus.catalogue-activation` | PASS |  | `logs/menus.catalogue-activation.log`<br>`shots/menus.catalogue-activation/01-final-page-1.png`<br>`shots/menus.catalogue-activation/02-final-page-2.png`<br>`shots/menus.catalogue-activation/03-final-page-3.png` |
| `menus.catalogue-history` | PASS |  | `logs/menus.catalogue-history.log`<br>`shots/menus.catalogue-history/01-final-page-1.png` |
| `menus.d1-video-tile-name` | PASS |  | `logs/menus.d1-video-tile-name.log`<br>`shots/menus.d1-video-tile-name/01-staff-portfolio.png` |
| `menus.d2-archive-button-name` | PASS |  | `logs/menus.d2-archive-button-name.log`<br>`shots/menus.d2-archive-button-name/01-archive-item-360.png`<br>`shots/menus.d2-archive-button-name/02-unarchive-item.png` |
| `menus.draft-conflict` | PASS |  | `logs/menus.draft-conflict.log`<br>`shots/menus.draft-conflict/01-final-page-1.png`<br>`shots/menus.draft-conflict/02-final-page-2.png` |
| `menus.import-validation` | PASS |  | `logs/menus.import-validation.log`<br>`shots/menus.import-validation/01-final-page-1.png` |
| `menus.label-batch` | PASS |  | `logs/menus.label-batch.log`<br>`shots/menus.label-batch/01-final-page-1.png`<br>`shots/menus.label-batch/02-final-page-2.png` |
| `menus.label-boundaries` | PASS |  | `logs/menus.label-boundaries.log` |
| `menus.label-conflict` | PASS |  | `logs/menus.label-conflict.log`<br>`shots/menus.label-conflict/01-menu-updated-error.png`<br>`shots/menus.label-conflict/02-labels-saved-after-reload.png` |
| `menus.label-ownership` | PASS |  | `logs/menus.label-ownership.log`<br>`shots/menus.label-ownership/01-final-page-1.png`<br>`shots/menus.label-ownership/02-final-page-2.png` |
| `menus.label-skip-later` | PASS |  | `logs/menus.label-skip-later.log`<br>`shots/menus.label-skip-later/01-final-page-1.png`<br>`shots/menus.label-skip-later/02-final-page-2.png` |
| `menus.label-transfer` | PASS |  | `logs/menus.label-transfer.log`<br>`shots/menus.label-transfer/01-final-page-1.png`<br>`shots/menus.label-transfer/02-final-page-2.png` |
| `menus.library-filters` | PASS |  | `logs/menus.library-filters.log`<br>`shots/menus.library-filters/01-final-page-1.png` |
| `menus.o1-save-while-reloading` | PASS |  | `logs/menus.o1-save-while-reloading.log`<br>`shots/menus.o1-save-while-reloading/01-save-disabled-while-reloading.png` |
| `menus.o2-narrow-draft-editor` | FAIL | 1 of 1 test(s) failed. First: menus.o2-narrow-draft-editor: at 360px section names are readable and the save bar is one row [chromium]: Error: Observation reproduced (design observation, not a defect): section names clipped at 360px: House Special, Appetisers, Chef's Specials, From the Clay Oven, Dum Biryani, Chowmein, Our Mixed Grills, Authentic Curries, Kitchen Companions, Pub Favourites, Chips & Fries, Kids Plates, Sweet Finish, Sister Pub Specials | `logs/menus.o2-narrow-draft-editor.log`<br>`shots/menus.o2-narrow-draft-editor/01-draft-editor-360.png`<br>`shots/menus.o2-narrow-draft-editor/02-screenshot.png` |
| `menus.o3-usage-docs` | PASS |  | `logs/menus.o3-usage-docs.log` |
| `menus.o4-phone-project` | PASS |  | `logs/menus.o4-phone-project.log` |
| `menus.o5-early-file-choice` | FAIL | 1 of 1 test(s) failed. First: menus.o5-early-file-choice: a menu file chosen before the page hydrates is still previewed [chromium]: Error: Observation reproduced (design observation, not a defect): a file chosen before hydration is ignored (no preview appeared) | `logs/menus.o5-early-file-choice.log`<br>`shots/menus.o5-early-file-choice/01-after-hydration.png`<br>`shots/menus.o5-early-file-choice/02-screenshot.png` |
| `menus.responsive-a11y` | PASS |  | `logs/menus.responsive-a11y.log`<br>`shots/menus.responsive-a11y/01-menus-venues_360.png`<br>`shots/menus.responsive-a11y/02-menus-venue_360.png`<br>`shots/menus.responsive-a11y/03-menus-import-preview_360.png`<br>`shots/menus.responsive-a11y/04-menus-draft-editor_360.png`<br>`shots/menus.responsive-a11y/05-menus-activate-dialog_360.png`<br>`shots/menus.responsive-a11y/06-library-filters-open_360.png`<br>`shots/menus.responsive-a11y/07-label-editor-single-search_360.png`<br>`shots/menus.responsive-a11y/08-label-editor-single-missing_360.png`<br>`shots/menus.responsive-a11y/09-label-editor-batch-variant_360.png`<br>`shots/menus.responsive-a11y/10-label-editor-batch-adjust_360.png` |
| `menus.unavailable-items` | PASS |  | `logs/menus.unavailable-items.log`<br>`shots/menus.unavailable-items/01-archived-item-not-offered.png`<br>`shots/menus.unavailable-items/02-unavailable-items-error.png`<br>`shots/menus.unavailable-items/03-suggestion-on-menus-page.png`<br>`shots/menus.unavailable-items/04-suggestion-resolved.png` |
