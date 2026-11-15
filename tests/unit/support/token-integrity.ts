/*
 * Readers and colour maths for tests/unit/token-integrity.test.ts. They live
 * here so each can be tried on a small string or a known colour, away from
 * app/globals.css.
 */

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, "")
  )
}

export type Block = { selectors: string[]; body: string }

// Every innermost `selector { declarations }` block. A block that holds
// other blocks (@layer, @media, @utility with a nested rule) is not returned
// itself; its children are.
export function blocks(css: string): Block[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (match) => ({
      // What comes before the selector may be the end of an earlier
      // statement (`@import …;`).
      selectors: (match[1].split(";").pop() ?? "")
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
      body: match[2],
    })
  )
}

export function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    found.set(match[1], match[2].trim().replace(/\s+/g, " "))
  return found
}

// The custom properties a selector declares, across every block that names
// it (":root" is declared twice: once alone, once with ".dark").
export function declaredOn(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const block of blocks(css))
    if (block.selectors.includes(selector))
      for (const [name, value] of declarations(block.body))
        found.set(name, value)
  return found
}

// The keys of every @theme block, inline or not.
export function themeKeys(css: string): string[] {
  return blocks(css)
    .filter((block) => block.selectors.some((s) => /^@theme\b/.test(s)))
    .flatMap((block) => [...declarations(block.body).keys()])
}

// The names of the @utility rules.
export function utilityNames(css: string): string[] {
  return [...stripCssComments(css).matchAll(/@utility\s+([\w-]+)/g)].map(
    (match) => match[1]
  )
}

/*
 * Every custom property a var() can read. A key in `@theme inline` is not
 * one: Tailwind writes its value straight into the utilities and never emits
 * the key, so `var(--color-ink)` would resolve to nothing in the browser.
 * (A plain @theme key is emitted once something uses it.)
 */
export function definedProperties(css: string): Set<string> {
  const readable = stripCssComments(css).replace(
    /@theme\s+inline\s*\{[^{}]*\}/g,
    ""
  )
  return new Set(
    [...readable.matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)].map(
      (match) => match[1]
    )
  )
}

// `var(--x)`, and Tailwind's shorthand for it in a class: `w-(--x)`.
export function referencedProperties(source: string): string[] {
  return [...source.matchAll(/(?:var\(|-\()\s*(--[\w-]+)/g)].map(
    (match) => match[1]
  )
}

// A `const NAME = ["a", "b"]` list in lib/utils.ts.
export function listIn(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)
  if (!match) throw new Error(`lib/utils.ts has no list called ${name}`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1])
}

/* ------------------------------------------------------------ colour */

export type Oklch = { l: number; c: number; h: number; alpha: number }

export function parseOklch(value: string): Oklch {
  const match =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/.exec(
      value.trim()
    )
  if (!match) throw new Error(`Not an oklch() colour: ${value}`)
  const part = (text: string) =>
    text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text)
  return {
    l: part(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : part(match[4]),
  }
}

// OKLCH to linear-light sRGB (Björn Ottosson's matrices), clipped to the
// sRGB gamut one channel at a time. A browser maps out-of-gamut colours with
// more care, but every token here is in gamut or within a rounding step of
// it, so the two agree to well inside the margins the test asks for.
export function oklchToLinearSrgb({
  l,
  c,
  h,
}: Oklch): [number, number, number] {
  const hue = (h * Math.PI) / 180
  const a = c * Math.cos(hue)
  const b = c * Math.sin(hue)
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  return [
    clip(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    clip(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    clip(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  ]
}

// WCAG 2 relative luminance, from linear-light channels.
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(one: number, other: number): number {
  const [light, dark] = one > other ? [one, other] : [other, one]
  return (light + 0.05) / (dark + 0.05)
}

// The sRGB transfer curve, for checking the maths against a known hex.
export function toHex(linear: [number, number, number]): string {
  const encode = (channel: number) =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055
  return `#${linear
    .map((channel) =>
      Math.round(encode(channel) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

// Follow `var(--other)` until the value is a colour.
export function resolve(tokens: Map<string, string>, name: string): string {
  let value = tokens.get(name)
  for (let hops = 0; hops < 8; hops++) {
    if (value === undefined) throw new Error(`${name} is not defined`)
    const alias = /^var\((--[\w-]+)\)$/.exec(value)
    if (!alias) return value
    value = tokens.get(alias[1])
  }
  throw new Error(`${name} does not resolve to a value`)
}

// False for a see-through colour, which draws no boundary of its own.
export function isOpaque(tokens: Map<string, string>, name: string): boolean {
  return parseOklch(resolve(tokens, `--${name}`)).alpha === 1
}

export function contrastOf(
  tokens: Map<string, string>,
  foreground: string,
  background: string
): number {
  const [front, back] = [foreground, background].map((name) => {
    const colour = parseOklch(resolve(tokens, `--${name}`))
    // A see-through colour has no contrast of its own: it depends on what
    // is under it. Such a token cannot be in the table.
    if (colour.alpha !== 1) throw new Error(`--${name} is not opaque`)
    return luminance(oklchToLinearSrgb(colour))
  })
  return contrastRatio(front, back)
}
