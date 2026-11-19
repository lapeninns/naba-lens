# CoverageMeter

How much of one category is covered, as a count, a percentage and a bar that separates “not collected” from “not yet reviewed”.

- Always show numerator and denominator in `figure` (“30/40”) with the percentage beside it. Never a percentage alone.
- Bar segments, in order: covered (`bottle`), awaiting review (`sky`), need replacing (`signal`); the remaining track is missing. Only covered counts toward the percentage.
- The legend repeats every segment as a `StatusChip` with its count, so the bar is never read by colour alone. Give the bar `role="img"` and an `aria-label` with the same counts.
- One meter per category: Food, Drinks, Spaces, Facilities. Don’t merge them into one number, and don’t use it to rank people.
- You provide: category name and the four counts. Each count should link to the records behind it.
