# Naba-Lens design system: developer package

Version 2, 18 November 2026. The browsable version, with live previews, is the Naba-Lens design system in Claude.

## What is here

| File | Use |
| --- | --- |
| `tokens.css` | Every colour, space, radius, size and type style as CSS variables, light and dark. Load this first. |
| `components.css` | The 21 components as plain CSS classes prefixed `nl-`. Load after `tokens.css`. |
| `tokens.json` | The same tokens as data, with a usage note on each. |
| `tailwind.preset.js` | Optional Tailwind 3 preset mapped to the CSS variables. |
| `GUIDELINES.md` | The rules: voice, colour, status language, type, layout, states, accessibility. Read this before building. |
| `SCREENS.md` | Which components make up each staff, manager and admin screen. |
| `components/<Name>/README.md` | When to use the component, what you provide, do and don’t. |
| `components/<Name>/example.html` | Working markup. Open it in a browser. |

## Set up (Next.js)

1. Copy `tokens.css` and `components.css` into your styles folder and import both, in that order, in the root layout.
2. Load the fonts with `next/font/google`: Figtree (400, 500, 600, 700) and Fraunces (600). Assign them to the `--font-sans` and `--font-display` variables, then delete the `@import` on line 1 of `components.css`.
3. Leave `<html>` without `data-theme` for light; set `data-theme="dark"` for dark.
4. Build each component as a React component that renders the markup in its `example.html` and keeps the `nl-` class names.

## Rules that matter most

- Use a token for every value. Do not hard-code a hex colour or pixel size.
- Every status is a `StatusChip` with a tone, an icon and a word, chosen from the status table in `GUIDELINES.md`.
- One primary (green) button per view.
- Staff actions are at least 48px tall; desktop manager and admin controls are 40px.
- The focus outline is never removed.

## Not included

- A logo: set “Naba-Lens” as plain text.
- An icon set: the examples inline Lucide-style icons. Install `lucide-react` and use it at 1.75 stroke width.
- Photographs: examples use empty placeholders.
