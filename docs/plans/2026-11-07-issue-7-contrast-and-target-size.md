# Plan: Secondary text fails WCAG contrast (2.48:1) and controls are below 24px target size (issue #7)

Risk tier: Medium. CSS-only presentation change (colors, control sizes, a reduced-motion block) plus a token test. Rendered contrast, hit areas, and emulated reduced motion cannot be proven in jsdom, so a live browser drive is required, and it alters existing visuals that #4 and #5 tuned (focus rings, 375/768/1440 layout). No API, store, data, or security code is touched.

Domain skills:
- superpowers:test-driven-development: invoke.
- chrome-devtools-mcp:a11y-debugging: invoke for the live drive (contrast, tap targets, reduced motion). If the chrome-devtools MCP fails (locked profile), use Playwright via npx instead.
- frontend-design: not applicable because the user fixed the visual direction: keep the dark HUD identity and make the smallest color and size change that passes.
- vercel-react-best-practices: not applicable because no React logic changes.
- dataviz, django, fastapi, expo, payments, email: not applicable because none of that is touched.

## Acceptance criteria

1. Every text color/background pair actually used in `src/index.css` meets 4.5:1 (all text here is under 18.66px bold / 24px, so the large-text 3:1 exception never applies). Backgrounds are modeled as rendered:
   - Header (`.app-header`, not over the map): `--bg-panel` composited over `--bg-void`.
   - Layer panel, GPU panel, popup rows (all float over the map canvas, which can show anything): `--bg-panel` composited over `#ffffff`, the worst case.
   - Popup header (opaque): `--bg-deep`.
   - Classification badge: `--bg-void` text on `--accent`.
   - Text with `opacity` is composited at that opacity before measuring.
2. Non-text UI parts that identify a control or its state meet 3:1 (WCAG 1.4.11) against the same worst-case panel background: the slider track, the slider thumb, the off-state layer dot.
3. Every interactive target is at least 24x24 CSS px (WCAG 2.5.8): popup Close button at least 24x24; stress slider input box at least 24px tall (full width); slider thumb box at least 24x24 in both WebKit and Firefox pseudo-elements; layer rows, the narrow "Sensor layers" toggle, and MapLibre's attribution button measured in the browser and at least 24x24.
4. With `prefers-reduced-motion: reduce`, no CSS animation or transition runs: `.panel-indicator` (blink-pulse), `.feature-popup` (slide-up on wide, fade-in on narrow from #5), and the hover transitions all compute `animation-name: none` and zero transition duration. Without the preference, the animations still run as before.
5. A unit test computes WCAG contrast from the `:root` token values parsed out of `src/index.css` for every pair in criteria 1 and 2, and fails if any `color:` declaration in `src/index.css` is not covered by that pair table (so a new text color cannot slip in unmeasured). It also asserts criterion 3's CSS sizes and criterion 4's reduced-motion block.
6. The #4 and #5 work is preserved: all existing tests pass unchanged; focus rings unchanged; at 375x812, 768x1024, and 1440x900 the #5 checks still hold (header elements do not overlap pairwise; `.app-header`, `.layer-panel`, `.gpu-info-panel`, and an open `.feature-popup` stay inside the viewport; the popup and GPU panel do not overlap at 768; `.stress-count` fits "5.0M PTS").
7. Dark HUD identity kept: hues unchanged; `--text-dim` stays visibly dimmer than `--text-primary`.

## Decisions

- `--text-dim`: `#2d5a42` -> `#4f9170`. It is the smallest step along the line from the current value toward `--text-primary` (`#6ec49a`, same hue family) that clears 4.5:1 with margin on the worst-case background: about 4.66:1 on `--bg-panel` over white, 5.26:1 on `--bg-deep`. (The issue's suggested `#5f9c7c` gives about 6.1:1, more than needed.) Confirm the numbers in the test; if any pair lands under 4.5, step further along the same line and record the value here.
- `.gpu-info-sep` loses `opacity: 0.5`: at half opacity even the new dim is about 2.3:1. It shows only above 1024px.
- No other text color changes: `--text-primary`, `--text-bright`, `--accent`, `--amber`, `--red` (about 4.8:1 worst case), `--blue` all already pass; the test proves it.
- 12px minimum font size (the issue's "consider"): not done. Raising the 8 to 11px text (badge, status, GPU panel, panel labels) would undo the 641px header spacing and the GPU panel widths that #5 tuned. Noted in the PR as a follow-up.

## Files that change

- `src/index.css`:
  - `:root`: `--text-dim: #4f9170`.
  - `.gpu-info-sep`: remove `opacity: 0.5`.
  - `.popup-close`: `width: 24px; height: 24px` (was 20). Nothing else in the rule changes.
  - `.stress-slider`: `height: 24px; background: transparent` (the input box becomes the 24px-tall hit area). Draw the visible track with `::-webkit-slider-runnable-track { height: 4px; background: var(--text-dim) }` and `::-moz-range-track { height: 4px; background: var(--text-dim) }` (4px, up from 2px, for visibility).
  - Thumbs (`::-webkit-slider-thumb` and `::-moz-range-thumb`): 24x24 box, `border: none`, transparent base, with the visible square and its glow painted by backgrounds so the look stays close to today: `background: linear-gradient(var(--blue), var(--blue)) center / 12px 12px no-repeat, radial-gradient(closest-side, rgba(0, 170, 255, 0.45), transparent)`; drop `box-shadow` (it would glow around the 24px box). WebKit thumb needs `margin-top: -10px` to center on the 4px track ((4 - 24) / 2). The `:focus-visible` outline on the input stays.
  - New last block:
    ```css
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
    ```
    `!important` is needed to beat the narrow block's later `animation-name: fade-in` and any library animation. `.panel-indicator` then sits at its base `opacity: 1`.
- `src/styles.test.js` (new): reads `src/index.css` with `readFileSync` (pattern from `src/manifest.test.js`), strips comments, parses `:root` custom properties (hex and `rgba()`), implements WCAG relative luminance and contrast, alpha compositing, and asserts:
  - the pair table for criteria 1 and 2 (selector, foreground token, background model, required ratio), each pair at or above its ratio, with the computed ratio in the assertion message;
  - coverage: every innermost rule in the file with a `color:` declaration has its selector in the pair table;
  - `.popup-close` width and height >= 24px; `.stress-slider` height >= 24px; both thumb pseudo-element rules width and height >= 24px;
  - the `@media (prefers-reduced-motion: reduce)` block exists and sets `animation: none !important` and `transition: none !important` on `*`;
  - a sanity check of the contrast function itself: black on white is 21:1, and the old `#2d5a42` on `#020c18` is about 2.48:1 (matches the issue).
- `README.md`: only if a line becomes false (none expected). Phase 8 checks.

## Order of work

1. Write `src/styles.test.js`; run it red against current CSS (contrast for dim pairs, close size, thumb size, slider height, reduced-motion block all fail). Commit it alone red: `test: add failing contrast, target size, and reduced motion checks (#7)`.
2. CSS changes; test green. Commit `fix: raise secondary text contrast, enlarge close and slider targets, honor reduced motion (#7)`.
3. Full gate.
4. Live drive (below); tune only inside the named selectors; rerun the gate after any tuning.

## Risks

- Range input styling differs per engine: with `appearance: none`, Chrome needs the runnable-track pseudo or the input's own background becomes the track; Firefox uses `::-moz-range-track`. Verify the thumb centers on the track and that dragging and clicking the track still work.
- The 24px slider grows the layer panel by about 22px; on narrow screens the panel is capped and scrolls (#5), so check 375x812 expanded and the 768 and 1440 layouts.
- The 24px Close grows the sticky popup header by a few px; check Close is still topmost and inside the viewport at 375.
- A universal reduced-motion rule also stops MapLibre's own CSS animations and transitions; that is the user's stated preference. JS camera motion is not involved: the app has no `flyTo`/`easeTo`.
- Lighthouse (axe) can mark contrast over the map canvas as "incomplete" rather than failed, so its color-contrast audit may pass before and after; that is why the token test and the drive's computed checks are the primary proof.
- Choosing not to: restructure markup (for example `aria-hidden` on separators), change fonts or sizes beyond the targets, or change any token other than `--text-dim`.

## Proof

- `src/styles.test.js` covers criteria 1, 2, 3 (CSS sizes), 4 (CSS block), and 5. Red output before the fix is the commit of step 1.
- Existing suites unchanged and passing: criterion 6 (#4 behavior).
- Live drive against `npm run build` + `npm run preview` (dev server only if needed to open the popup, for example by `await import('/src/store/mapStore.js')` in the page and calling `setSelectedFeature`), headless Chrome via Playwright run with npx:
  - criterion 3: `getBoundingClientRect()` of `.popup-close`, `.stress-slider`, each `.layer-row`, the narrow `.panel-toggle`, and `.maplibregl-ctrl-attrib-button` if present; thumb size from the drive (for example a screenshot crop or computed style where the engine exposes it); clicking the track and dragging the thumb still change the value.
  - criterion 1 in the browser: computed `color` of the dim-text elements equals the new token; MapLibre attribution text contrast computed from its computed styles.
  - criterion 4: with `reducedMotion: 'reduce'`, computed `animationName` of `.panel-indicator` and an open `.feature-popup` at 1440 and 375 is `none`, and `transitionDuration` of `.layer-row` is `0s`; without it, `blink-pulse`, `slide-up`, and `fade-in` respectively.
  - criterion 6: the #5 geometry checks at 375x812, 768x1024, 1440x900 (with popup open at each, and layer panel expanded at 375).
  - Lighthouse: `npx lighthouse@12 <preview url> --only-categories=accessibility` headless, desktop preset and default mobile, recording score, `color-contrast`, and `target-size`. Baseline on `origin/main` (0131dc1), recorded by the coordinator: score 1 on both, `color-contrast` pass and `target-size` pass with no items on both, which is the "incomplete over canvas" limitation in Risks.
