# SubjectCard

An album tile for one dish, drink, space or facility: its main approved photo, its name and its status.

- The photo is 4:3, `radius-md`, cropped with `object-fit: cover`. With no approved photo, use `nl-subject__photo--empty`: a dashed outline and a camera icon.
- `nl-subject__pending` shows a count of uploads awaiting review on `scrim`. Staff see the count, never other people’s unreviewed photos.
- One `StatusChip` under the name: Needed, Awaiting review, Approved or Needs updating.
- You provide: the image (a thumbnail rendition, never the original), name, status, optional pending count and the link target. Lay tiles out in `nl-grid`.
- The whole tile is one link; don’t nest buttons inside it.
