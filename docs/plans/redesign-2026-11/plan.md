# Whole-app redesign with Open Design (batch R, 21 Nov 2026)

Owner: Aman Kumar Shrestha. Asked on 21 Nov 2026: redesign the whole app
with Open Design (the desktop design workspace), staff first, then manager,
then admin, and implement it in this repo. Design partner: Open Design,
reached through its MCP server (`open-design`, see the owner's local setup).

Rules that do not change: design system v2 on Album's behaviour (D10),
tokens in `app/globals.css`, components from `catalogue.md`, no in-app
camera, StatusChip words, no messaging or approval-workflow features
(scope guard), WCAG 2.2 AA, 48px staff targets, 320px and 200% zoom.

## Tasks and acceptance

| ID  | Task                                               | Done when                                                                                                                                                                |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R0  | D21: immediate Album posting on by default         | Switch defaults on, `=0` restores D9, legacy tests pin it off, docs updated                                                                                              |
| R1  | Staff shell fixes from the audit                   | Staff error and loading boundaries name the right page and keep the tab bar; no "Home" leftovers; tabs light correctly; Me subpages use one back link                    |
| R2  | Staff photo workflow per the 20 Nov handoff        | Added photos screen with Label now / Label later, tick-then-label batch labelling with a confirm bar and a saved result naming the folder, Unlabelled first in My photos |
| R3  | Staff Today, Me hub and subpages per the prototype | Today is one "Needs you" list; Me, Settings, Help, notices, people use the shared subpage frame                                                                          |
| R4  | Manager IA and screens per Open Design             | One meaning for "Album"; every section reachable from nav; boundaries per section; VenueBar on review                                                                    |
| R5  | Admin IA and screens per Open Design               | No orphan routes; correct active section; boundaries per section; back links on detail pages                                                                             |
| R6  | Auth screens on v2                                 | Sign-in, confirm, MFA and blocked off Common Room                                                                                                                        |
| R7  | Validation                                         | typecheck, lint, unit, focused UI tests for each change, browser pass at 360/390/1280 on a local stack, axe on key screens                                               |

The audit that motivated these tasks is in `audit.md` next to this file.
Release: one bundled PR; production needs the two pending migrations
(20261120120000, 20261120130000) applied before merge, by the owner.
