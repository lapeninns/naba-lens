// Naba-Lens Tailwind preset (Tailwind 3). Colours point at the CSS variables in tokens.css,
// so light and dark themes switch with data-theme on <html>.
// Usage: module.exports = { presets: [require('./tailwind.preset.js')], content: [...] }
module.exports = {
  "darkMode": [
    "selector",
    "[data-theme=\"dark\"]"
  ],
  "theme": {
    "screens": {
      "tablet": "768px",
      "desktop": "1100px"
    },
    "colors": {
      "transparent": "transparent",
      "current": "currentColor",
      "paper": "var(--paper)",
      "surface": "var(--surface)",
      "surface-sunken": "var(--surface-sunken)",
      "surface-hover": "var(--surface-hover)",
      "line": "var(--line)",
      "line-strong": "var(--line-strong)",
      "ink": "var(--ink)",
      "ink-muted": "var(--ink-muted)",
      "bottle": "var(--bottle)",
      "bottle-strong": "var(--bottle-strong)",
      "bottle-soft": "var(--bottle-soft)",
      "on-bottle": "var(--on-bottle)",
      "brass": "var(--brass)",
      "brass-ink": "var(--brass-ink)",
      "brass-soft": "var(--brass-soft)",
      "sky": "var(--sky)",
      "sky-soft": "var(--sky-soft)",
      "signal": "var(--signal)",
      "on-signal": "var(--on-signal)",
      "signal-soft": "var(--signal-soft)",
      "focus": "var(--focus)",
      "scrim": "var(--scrim)",
      "on-photo": "var(--on-photo)"
    },
    "spacing": {
      "0": "0",
      "px": "1px",
      "1": "4px",
      "2": "8px",
      "3": "12px",
      "4": "16px",
      "5": "24px",
      "6": "32px",
      "7": "48px",
      "target-staff": "48px",
      "target-compact": "40px"
    },
    "borderRadius": {
      "none": "0",
      "sm": "6px",
      "md": "12px",
      "lg": "20px",
      "full": "999px"
    },
    "fontFamily": {
      "display": [
        "var(--font-display)"
      ],
      "sans": [
        "var(--font-sans)"
      ]
    },
    "fontSize": {
      "display": [
        "32px",
        {
          "lineHeight": "36px",
          "fontWeight": "600",
          "letterSpacing": "-0.01em"
        }
      ],
      "title": [
        "22px",
        {
          "lineHeight": "28px",
          "fontWeight": "600"
        }
      ],
      "figure": [
        "28px",
        {
          "lineHeight": "32px",
          "fontWeight": "600"
        }
      ],
      "heading": [
        "17px",
        {
          "lineHeight": "24px",
          "fontWeight": "600"
        }
      ],
      "body": [
        "16px",
        {
          "lineHeight": "24px",
          "fontWeight": "400"
        }
      ],
      "label": [
        "15px",
        {
          "lineHeight": "20px",
          "fontWeight": "600"
        }
      ],
      "caption": [
        "13px",
        {
          "lineHeight": "18px",
          "fontWeight": "500"
        }
      ]
    },
    "boxShadow": {
      "raised": "var(--shadow-raised)",
      "none": "none"
    },
    "extend": {
      "maxWidth": {
        "content": "1200px",
        "sheet": "480px"
      },
      "width": {
        "rail": "240px"
      }
    }
  }
};
