# Style guide

One look for every screen: old stained paper and dark ink. There is exactly one
style sheet, [`client/paper.css`](../client/paper.css), and every screen must
link it. Menus look the same at any time of day, so there is no dark theme and
no automatic colour switching.

## Palette

| Token          | Hex       | Used for                                  |
| -------------- | --------- | ----------------------------------------- |
| `--paper`      | `#e8dbbd` | Panels and light areas                    |
| `--paper-edge` | `#b79b6b` | The browned board around panels           |
| `--ink`        | `#2a1c10` | Body text, headings, thin rules           |
| `--ink-faded`  | `#5b4631` | Secondary text, labels                    |
| `--wax`        | `#8c1d1d` | Wax-seal button background                |
| `--urgent`     | `#a3191b` | Urgent alert text                         |

Pure black (`#000`) and pure white (`#fff`) are never used. Button text on wax
uses `#f3e7cb`, a cream, not white.

Contrast on `#e8dbbd` paper: ink is 12.03:1, faded ink 6.47:1, urgent red
5.64:1, and cream text on wax red 7.41:1. All clear WCAG AA for normal text.

## Paper texture

The grain is one 160 × 160 px seamless tile generated as an SVG data URI inside
`paper.css`: fractal noise (`feTurbulence` with `stitchTiles="stitch"`) plus a
few short fibres drawn away from the tile edges. It repeats, so there are no
image files and no visible seams. Panels use the same tile blended onto the
cream with `background-blend-mode: multiply`.

Stains and fold lines are separate, faint gradients on `.paper::before`, placed
only at the corners and close to two edges. The pseudo-element sits behind the
panel content, so a stain never crosses text.

## Fonts

Both fonts are open-licence (SIL OFL 1.1) and are committed in `client/fonts/`:

- **IM Fell English** for titles and display text.
- **Source Sans 3** (400 and 600) for body text, numbers and tables.

The licence files sit next to the fonts. The build copies the whole folder to
`dist/fonts/`, and `paper.css` uses relative URLs, so the page works when served
from any path.

## Components

- `.paper` — plain panel: one ink border, a faint second rule, no sketches.
- `.btn` — inked-box button: transparent, thin ink rule, dark ink label.
- `.btn-seal` — red wax seal for important confirmations only.
- `.alert-urgent` — urgent text in red ink with a red left rule.
- `.rule` — a thin ink rule between groups.
- `.menu` — a menu list; same paper and ink as everything else.

## Sizes and touch

- Three UI sizes: `small`, `medium`, `large`, set by
  `<html data-ui-size="...">`. One variable, `--ui-scale`, drives all text and
  spacing. The page remembers the choice in `localStorage` under
  `armadas.uiSize`.
- Every button and touch target is at least 44 × 44 px (`--tap`), even in the
  small setting.
- The page column is `min(44rem, 100%)` with no fixed widths, so it never
  scrolls sideways on a phone.
- Keyboard focus is always visible as a wax-red outline.

## Game screen

The game reuses the same sheet and components. The canvas fills the screen, and
the HUD floats above it in paper panels: `.hud-top` for the room, follow button
and UI sizes, and `.hud-ship` for speed, heading, wind arrow and compass rose.
`.status` turns urgent red when the connection fails, and `.hint` carries the
control reminder on larger screens. On phones the top bar wraps and the ship
panel spans the bottom; the hint is hidden. The sea itself is a flat, muted
blue-green that sits comfortably beside the paper cream.
