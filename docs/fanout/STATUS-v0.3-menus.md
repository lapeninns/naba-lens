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
| D catalogue server | claude-team-05 opus-5.5 | nlm-catalogue @cc79f17 | B, C, E | active (stack 621xx) | integrate |
| F labels server | claude-team-06 opus-5.5 | nlm-labels @cc79f17 | B, G | active (stack 622xx) | integrate |
| H library discovery | claude-team-08 opus-5.5 | nlm-library @cc79f17 | B, F(stub) | active (stack 623xx) | integrate |
| I final review | tbd (cross-provider) | — | all | queued | — |
| J QA (e2e runner) | tbd | — | all | queued | — |
