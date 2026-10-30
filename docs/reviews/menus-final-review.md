# v0.3 menus/labels: independent final review and fixes

Reviewer: Codex gpt-6.1-sol (read-only, independent of every author), diff
`1741ccb..6cb8dd5`. No critical/high authorization bypass found. An earlier
contract review (same reviewer, 14 findings) became contract amendment A1.

| # | Severity | Finding | Fix (lead) | Regression test |
| --- | --- | --- | --- | --- |
| I-1 | Medium | `save_media_labels` read the caller's open suggestion unlocked; an admin resolve in between made the update hit zero rows while the save reported success and audited the text. | Every label save now takes the venue menu lock (shared) before reading the suggestion `FOR UPDATE`; lock order asset → label row → venue → suggestion, compatible with resolve (venue → suggestion). | `tests/security/menus-review-fixes.test.ts` I-1 |
| I-2 | Medium | A valid 1 MiB import could expand past the 1 MB Server Action body limit, so "Create draft"/save failed. | `MENU_IMPORT_LIMITS.documentMaxBytes` = 3 MiB enforced by `validateMenuDocument` (client and server); `serverActions.bodySizeLimit` = 4 MB in `next.config.ts`. | `tests/unit/menus-import-review-fixes.test.ts` |
| I-3 | Medium | Labelling catalogue embedded all entries in one request and stopped silently at `max_rows` (1000). | Sections and entries read separately; entries paged in a total order. | `menus-review-fixes.test.ts` I-3 (1005 items) |
| I-4 | Medium | Generated uncertain-match reasons could exceed 200 chars / 20 candidates, so draft creation failed. | Bounded generic reason; first 20 candidates kept and the reason states how many matched. | `menus-import-review-fixes.test.ts` |
| I-5 | Low | A labelled variant dropped from the active menu vanished from the variant filter. | Active items merge in variants still used by labels, marked "(not on active menu)". | `menus-review-fixes.test.ts` I-5 |

Verified OK by the reviewer: caller/role/ownership re-checks in every RPC;
no service-role catalogue/label writes; RLS visibility (drafts, other venues,
deleted/non-ready media, transfers); draft/activation locking and revision
CAS; composite FKs; append-only audit; current-name rule; `library_assets`
EXISTS semantics, same-tuple item+variant, LIKE escaping; import route
authorization-before-body, size bounds, private caching; no HTML injection
sinks or client secrets; upload independence.

## Re-review of 3351844

Same reviewer, read-only: I-1..I-5 **fixed**; no new defect and no new
deadlock cycle across the v0.3 functions, finalise, delete and cleanup.
Noted trade-off: the 4 MB Server Action limit applies to every action (bounded
parse cost before each action's own authorisation). Coverage gap raised for
I-1 (test was sequential) → added a two-session test that holds the venue lock
in `psql`, dismisses, and commits while a save runs. It **fails on the pre-fix
migration** (edit lost: one dismissed row) and passes with the fix (lead's
stack, 625xx).
