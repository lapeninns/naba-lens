# v0.3 menus/labels status board (lead-maintained)

Integration: branch `feat/nabalens-menus`, worktree
`~/.t3/worktrees/nabalens/feat-nabalens-menus`, base `1741ccb`; contract
`5476eb5`, amendment A1 `18962c8`. T3-managed worktree isolation was
unavailable for this thread (scratch, non-git project), so the lead created
one git worktree per writer under `~/.t3/worktrees/nabalens/nlm-*`.

| Packet | Owner / provider | Worktree / base | Depends | Status | Next |
| --- | --- | --- | --- | --- | --- |
| A lead | claude-team-07 opus-5.5 | feat-nabalens-menus | — | active: contract, A1, upload label action, Menus nav | integrate wave 1 |
| C0 source research | claude-team-01 opus-5.5, read-only | — | — | done | feeds C |
| I0 contract review | codex gpt-6.1-sol, read-only | — | — | done: 14 findings, all accepted as A1 | — |
| B database | claude-team-02 opus-5.5 | nlm-db @5476eb5 → 0843fcd | — | integrated (e3adda3); security 191/191 on own stack | — |
| C import | codex gpt-6.1-sol | nlm-import @18962c8 → d8f4f53 | C0 | integrated; 57 unit tests | — |
| E admin menu UI | claude-team-03 opus-5.5 | nlm-admin-ui @5476eb5 → 3829213 | — | integrated; 37 UI tests | D wires |
| G staff label UI | claude-team-04 opus-5.5 | nlm-label-ui @5476eb5 → c356187 | — | integrated; 32 UI tests | F/lead wire |
| D catalogue server | claude-team-05 opus-5.5 | nlm-catalogue @cc79f17 → cc1c29c | B, C, E | integrated; menus-server 14/14, browser smoke | — |
| F labels server | claude-team-06 opus-5.5 | nlm-labels @cc79f17 → e99727f | B, G | integrated; labels-server 16/16 | — |
| H library discovery | claude-team-08 opus-5.5 | nlm-library @cc79f17 → 62935e9 | B, F | integrated; library-filters suite pass | — |
| I final review | codex gpt-6.1-sol, read-only | feat-nabalens-menus @6cb8dd5 | all | active | fix findings |
| J QA (e2e runner) | claude-team-01 opus-5.5 | nlm-qa @6cb8dd5 (stack 624xx) | all | active | fix defects |

Lead integrated checks @6cb8dd5 (own stack 625xx, fresh reset): migrations
apply; `pnpm test:security` 7 files 222/222; `test:integration` 194 passed,
13 skipped, 11 failed (auth-invites 9, auth-bootstrap 1, auth-links 1),
identical on base 1741ccb against the same stack, so pre-existing; unit 338/338;
`pnpm build` OK; `pnpm scan:bundle` no findings.
