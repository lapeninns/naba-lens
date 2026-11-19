# Naba-Lens design system

The design system is called **Album** (adopted 17 Nov 2026, decision D8). It replaces Common Room, which still ships on screens not yet moved and is frozen for reference. This folder is the home of both.

| File                                     | What it is                                                                        | Read it when                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| [DESIGN.md](DESIGN.md)                   | Album: goal, principles, tokens, slot states, components, patterns, words, access | Before changing any screen, component or token |
| [proposals/album.md](proposals/album.md) | Why Album, and the product changes it brings                                      | Before planning an Album batch                 |
| [decisions.md](decisions.md)             | Decisions with an owner and a date                                                | Before proposing a change to a rule            |
| [departures.md](departures.md)           | Places where the product differs from the spec, each with a reason or an owner    | When you find or make an exception             |
| [catalogue.md](catalogue.md)             | Every shared component, its layer and how widely it is used                       | Before building a component                    |
| [common-room.md](common-room.md)         | The frozen Common Room spec, for screens that still ship it                       | When fixing a screen not yet moved to Album    |
| [components.md](components.md)           | Measured Common Room component values                                             | Same                                           |
| [strategy.md](strategy.md)               | The Nov 2026 Common Room audit and its `DS-xxx` batches                           | History only                                   |

## Where the truth lives

| Subject                               | Source of truth                                               |
| ------------------------------------- | ------------------------------------------------------------- |
| Every rule and what each token is for | `DESIGN.md`                                                   |
| Token values                          | `app/globals.css` (Album values from batch A1)                |
| The prototype                         | <https://claude.ai/artifact/GZUbKcemggcPgV5Rh1Qwyg> (private) |
| What components look like, rendered   | `/ui-preview` (dev only; returns 404 in production)           |

## Changing the system

1. Check the catalogue. If a component exists, extend it.
2. Change `DESIGN.md` in the same pull request as the code. Bump its version and add a line to its changelog.
3. Keep section numbers. Code comments cite them ("DESIGN.md §4"), and `tests/unit/design-citations.test.ts` fails when a cited section is missing from the spec a comment names.
4. Do not extend `common-room.md`. A screen that needs a change it cannot take moves to Album.
5. Record a deliberate exception in `departures.md`, and an unanswered question in `decisions.md`.

Explorations (prototype canvases, research folders) are not part of the system. A direction chosen there becomes a change to `DESIGN.md` before it becomes code.
