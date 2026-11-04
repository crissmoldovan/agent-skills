# Review at the boundary being crossed

Apply checks appropriate to the change. A static artboard does not need a functioning account,
search backend or product editor. Its gallery, links, theme and comparison navigation do need
to work. Do not report a checklist as evidence that it was executed.

## Functional checkpoint

- Exercise the meaningful path with realistic fictional content, plus relevant no-content,
  unknown, conflicting and invalid-input cases.
- Check Back/edit/reload and direct-link behavior where the product offers them. Verify a
  validation error clears after a valid correction, not merely that it appears.
- If a demo can replace the active context, enter it and return with the earlier data intact.
  Protect the user's active browser data; use an isolated review origin/profile as appropriate.
- Inspect structured content and related entities. A badge changing does not demonstrate a
  distinct content model; a co-occurrence does not establish a business relationship.
- Check source evidence, human edits, qualifications and proposed/confirmed states remain
  distinguishable where those concepts belong to the product.
- Run repository-required checks and relevant existing tests. Browser observations prove the
  local experience only, not deployed integrations, production access controls or backend semantics.

## Before sharing a visual comparison

1. Confirm all linked HTML, styles, scripts, images and fonts exist and are served successfully.
   If assets are generated, finish generation before adding a gallery entry.
2. Open the exact review address with the sanctioned browser tools. Inspect the actual styled
   index and every direction being offered, rather than only file presence or an HTTP status.
3. Capture a representative gallery screenshot and name the exact URL/port. Differentiate it
   from any functional-prototype server; never assume a configured port is the bound one.
4. Confirm visible ids/names and useful strengths/trade-offs; show available companion coverage.
5. Inspect representative small and large viewports, legibility, clipping and content density.
   Preserve useful control size and focus visibility as spacing becomes tighter.
6. If a design-skill inspector is unavailable or conflicts with sanctioned browser access, use
   the sanctioned route and record which source lint and rendered checks actually ran.

If rendering fails, repair and recheck before calling the artifact ready. A browser reload is
a remedy only after evidence identifies caching; it does not supply a missing stylesheet.

## Shortlist integrity

- The manifest has exactly the user's selected entries, stable ids, names and order.
- The active gallery shows only that set; historical source studies stay preserved separately.
- Every link opens the intended named direction. Previous/Next stays inside this set and follows
  its order. First/last behavior (disabled endpoints or deliberate wrapping) is predictable.
- Regenerate in a safe review copy, or inspect the generation path, to ensure it does not restore
  removed entries. Verify the final generated index, not just the selection document.

## Both themes for every selected direction

Track one row per direction/view/theme, including missing views:

| Direction / view | Theme | Render and contrast | Switch / keyboard / focus | Prev/Next / theme continuity | Evidence / gaps |
| --- | --- | --- | --- | --- | --- |
| Fictional direction / landing | Light or dark | Observed result | Observed result | Observed result | Screenshot or pending reason |

- Keep semantic tokens for background, layered surfaces, primary/secondary text, borders,
  links, accents, selected/hover/error states and focus. Inspect all used states in both palettes.
  A dark brand color may need a different light-theme accent and vice versa; preserve identity,
  not identical hex values or automatic inversion.
- Measure text/background pairs and essential control/focus boundaries against the project's
  applicable accessibility target; do not guess contrast from screenshots. In the absence of a
  specified target, use WCAG AA as the baseline and verify thresholds from the current official
  guidance: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
  Record tested pairs/states and failures; this is not a complete accessibility audit.
- Operate the gallery's accessible theme switch by pointer and keyboard. Its name/state should
  describe the choice. Confirm the visible gallery and previews actually change.
- Open every selected direction in both themes. Operate each mockup's own switch, including
  available companion views; do not rely on a switch that exists only on the index.
- Select dark in the gallery, open a detail, go Next then Previous and return to the gallery.
  Repeat with light. Prefer retaining the explicit choice through each step and reload; if
  persistence is intentionally limited, state the limit accurately.
- Check direct links without stored state and with an explicit choice. Avoid a system preference
  overriding the user's selection or mismatched themes in embedded previews.

## Review report

Report the artifact, exact tested address, observed checks, screenshot and known limits. Separate
"implemented", "browser-verified" and "awaiting user decision". If an item is pending, say what is
pending; do not claim completion based on a generator, agent self-report or a screenshot of another
revision. Progress updates should contain a new finding, decision, result or concrete blocker.
