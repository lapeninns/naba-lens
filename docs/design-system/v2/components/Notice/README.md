# Notice

A message that stays in the page until it is dealt with: an interrupted upload, offline drafts, a file that can’t be accepted, a venue change that will clear labels.

- Tones follow the status language: default (neutral), `nl-notice--progress`, `nl-notice--positive`, `nl-notice--attention`, `nl-notice--problem`. Every notice has the matching icon and a title in words.
- Title says what happened; text says what is safe and what to do next. One optional compact `Button` on the right.
- Use `role="status"` for information and `role="alert"` only for problems that block the task.
- You provide: tone, icon, title, text and an optional action. Place it directly above the thing it is about.
- Don’t use a notice for a routine success; use `Toast`. Don’t stack more than two.
