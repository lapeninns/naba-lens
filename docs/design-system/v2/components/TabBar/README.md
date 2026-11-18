# TabBar

Staff navigation fixed to the bottom of the phone: Home, Upload, Album, My uploads, in that order.

- Each tab is an icon over a `caption` label, at least 64px tall. The current tab has `aria-current="page"`, `bottle` colour and a bar along its top edge.
- Upload is the round `bottle` button (`nl-tab--upload`): the one persistent way to add a photo from anywhere.
- Managers get five text-and-icon tabs (Overview, Review, Album, Tasks, Venue) in the same bar on phone, and a side rail on desktop. Admins use a side rail.
- You provide: the current route. Don’t add a fifth staff tab; account, help and notifications live behind the profile control.
- Respect the bottom safe-area inset; lift it with `shadow-raised`.
