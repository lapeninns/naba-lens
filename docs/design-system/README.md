# Naba-Lens design system

The design system is called Common Room. This folder is its home in the repo.

| File                           | What it is                                                                              | Read it when                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [DESIGN.md](DESIGN.md)         | The spec: idea, tokens, state vocabulary, components, patterns, voice and accessibility | Before changing any screen, component or token |
| [catalogue.md](catalogue.md)   | Every shared component, its layer, how widely it is used and its status                 | Before building a component                    |
| [decisions.md](decisions.md)   | Open questions with an owner, and decisions already made                                | Before proposing a change to a rule            |
| [departures.md](departures.md) | Places where the product differs from the spec, each with a reason or an owner          | When you find or make an exception             |
| [strategy.md](strategy.md)     | The Nov 2026 audit, the direction and the roadmap batches (`DS-xxx`)                    | When planning design-system work               |

## Where the truth lives

| Subject                                | Source of truth                                     |
| -------------------------------------- | --------------------------------------------------- |
| Token values                           | `app/globals.css`                                   |
| What each token is for, and every rule | `DESIGN.md`                                         |
| State words, icons and shapes          | `components/nabalens/status-chip.tsx`               |
| What components look like, rendered    | `/ui-preview` (dev only; returns 404 in production) |

## Changing the system

1. Check the catalogue. If a component exists, extend it.
2. Change `DESIGN.md` in the same pull request as the code. Bump its version and add a line to its changelog.
3. Keep section numbers. Code comments cite them ("DESIGN.md §4"), and `tests/unit/design-citations.test.ts` fails when a cited section is missing.
4. Record a deliberate exception in `departures.md`, and an unanswered question in `decisions.md`.

Explorations (prototype canvases, research folders) are not part of the system. A direction chosen there becomes a change to `DESIGN.md` before it becomes code.
