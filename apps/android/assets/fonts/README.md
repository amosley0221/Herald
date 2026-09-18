# Bundled fonts

Both families are SIL Open Font License 1.1. The licences are alongside the
files as `OFL-Cinzel.txt` and `OFL-Jost.txt`, and must ship with any binary that
embeds them.

- **Cinzel** — headings, the wordmark, scores, numerals and dates.
  Weights 500 / 600 / 700.
- **Jost** — body copy, UI and labels. Weights 300 / 400 / 500.

These are static instances cut from the upstream variable fonts at the weights
the design uses. Android's font matching goes by PostScript name and does not
reliably interpolate a variable axis, so a variable file would silently render
every weight at its default. Regenerate with `scripts/build-fonts.mjs` if a new
weight is ever needed.
