# Plan: Layer toggles, stress slider, and feature popup are not keyboard or screen reader accessible (issue #4)

Risk tier: Medium. Stateful UI interaction (focus management, keyboard events) that unit tests cover only in jsdom, and it alters existing behavior (popup now takes focus, Escape closes it). Changes are confined to two components, their tests, and one stylesheet, with no API or store contract change.

Domain skills:
- superpowers:test-driven-development: invoke.
- chrome-devtools-mcp:a11y-debugging: invoke for the live drive (accessibility tree, focus, Tab order).
- vercel-react-best-practices: not applicable because no data fetching, bundle, or render performance work; one small focus effect only.
- frontend-design: not applicable because no new visual design; only focus indicators matching the existing accent token.
- dataviz, django, fastapi, expo, payments, email: not applicable because none of that is touched.

## Acceptance criteria

1. Every layer toggle (Airports, Sea Ports, and Heatmap when supported), the stress slider, and the popup close button are in the Tab order and operable from the keyboard: Space toggles a layer checkbox, arrow keys move the slider, Enter and Space activate the close button.
2. Each of those controls, and the popup dialog itself, shows a visible `:focus-visible` indicator (2px solid outline in `var(--accent)`, not clipped or covered by its container) that meets WCAG 2.4.7 and 2.4.11. `.stress-slider` no longer removes the focus indicator without replacement.
3. Accessible names and roles: each layer toggle is a native checkbox named "<Label> layer" (for example "Airports layer", "Sea Ports layer", "Heatmap layer") with its checked state; the slider is named "Stress test point count" and has `aria-valuetext` like "500,000 points"; the popup has `role="dialog"` with `aria-labelledby` pointing at its title; the close button is named "Close" (capitalized) and its glyph is hidden from assistive technology.
4. When the popup opens, focus moves to the dialog. Escape closes it (via `onClose`). When it closes, focus returns to the element that was focused before it opened, if that element is still in the document.
5. A Lighthouse accessibility audit of the built app reports no `label`, `button-name`, `aria-*-name`, or other label/name failures. Baseline on `origin/main` (10731f7): score 0.95, one failure, `label` on the stress-test range input.
6. Visible layout is unchanged apart from focus indicators: checkboxes are visually hidden with a standard `.visually-hidden` pattern, not `display: none`.

Out of scope (documented in the PR): the optional "keyboard path to features" (searchable list or nearest-feature action) and closing the popup on empty map click; issue #5 (mobile layout) and issue #7 (contrast, 24px targets, reduced motion).

## Files that change

- `src/components/LayerPanel.jsx`: checkbox gets `className="visually-hidden"` and `aria-label={`${label} layer`}`; decorative dot and ON/OFF spans get `aria-hidden="true"` (the checkbox's checked state already conveys it). Slider gets `aria-label="Stress test point count"` and `aria-valuetext={formatValueText(stressCount)}` where `formatValueText(n)` returns `${n.toLocaleString('en-US')} points`.
- `src/components/FeaturePopup.jsx`: outer div gets `role="dialog"`, `aria-labelledby` (id from `useId()`) on the title span, `tabIndex={-1}`, and a ref. A `useEffect` keyed on whether a feature is open (`const open = feature != null`) does: on open, save `document.activeElement`, focus the dialog; register a `keydown` listener on `document` that calls `onClose()` on `Escape`; on cleanup (close or unmount) remove the listener and, if the saved element is still connected and has `focus`, focus it. Keep `onClose` in a ref (updated in an effect) so a new inline `onClose` each App render does not re-run the open effect and steal focus again. Switching from one feature to another while open must not re-save the return target. Close button: `aria-label="Close"`, glyph wrapped in `<span aria-hidden="true">`. Hooks run before the `if (!feature) return null` early return.
- `src/index.css`: replace `.layer-row input[type='checkbox'] { display: none; }` with a global `.visually-hidden` utility (clip-path/inset pattern: `position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0`). Add `.layer-row:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }`. Replace `outline: none` on `.stress-slider` with a `.stress-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }` rule. Add `.popup-close:focus-visible` and `.feature-popup:focus-visible` outlines. Use negative or small offsets so the panel's `overflow` does not clip them (check `.layer-panel` overflow in the live drive). Do not change colors, sizes, or animations (issue #7 owns those).
- `src/components/LayerPanel.test.jsx`: add tests (see Proof). Existing tests stay.
- `src/components/FeaturePopup.test.jsx`: add tests (see Proof). Existing tests stay; the close-button test queries `{ name: 'Close' }`.
- `package.json`, `package-lock.json`: add devDependency `@testing-library/user-event` (latest 14.x) for real Tab, Space, arrow, and Escape key sequences. Dev only, so `npm audit --omit=dev` is unaffected.
- `docs/plans/2026-11-07-issue-4-keyboard-screen-reader-a11y.md`: this file.

## Order of work

1. Install `@testing-library/user-event` as a devDependency (`npm install -D @testing-library/user-event@^14`).
2. Red: add the new LayerPanel and FeaturePopup tests; run `npm test` and confirm they fail for the right reasons. Commit the red tests (with the dependency) alone.
3. Green: LayerPanel changes, FeaturePopup changes. Run `npm test`.
4. CSS changes.
5. Full gate in order: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high`.
6. Lighthouse after (`npx -y lighthouse@12` against `npx vite preview`, headless Chrome, accessibility only) and the live drive.

## Risks

- Focus stealing: re-running the open effect on every App render (App passes a new inline `onClose` on every render, and App re-renders on store changes such as viewport moves) would repeatedly yank focus to the popup. Mitigated by keying the effect on `open` only and reading `onClose` from a ref. Tested by rerendering with a new `onClose` and checking focus did not move back.
- Escape listener on `document` fires even if focus is elsewhere (for example on the map); that is intended so Escape always dismisses the popup. It must be removed when closed (tested: Escape after close does not call `onClose` again).
- `:has()` needs a current browser; the app already requires WebGPU-capable Chrome/Edge/Firefox/Safari versions which all support `:has()`.
- `.layer-panel` may clip outlines if it has `overflow: hidden`; inset outlines (`outline-offset: -2px`) avoid that.
- Visually hidden checkbox must still receive the label click (native label association preserved since the input stays inside the `<label>`).
- Chose not to: switch to `role="switch"` (native checkbox already matches the AC wording "checkbox, checked"), add a focus trap (non-modal dialog; trapping would break the map), add map-feature keyboard navigation, or close on empty map click.

## Proof

- Criterion 1: LayerPanel test tabs with `user-event` through the panel and asserts focus lands on each checkbox (three with heatmap supported) and then the slider; `user.keyboard(' ')` on a focused checkbox calls `onToggle('airports', false)`; a one-step `change` on the slider sets `stressCount` to 100000 and `aria-valuetext` to "100,000 points" (arrow keys themselves are proven in the live drive; see Deviations). FeaturePopup test: Tab reaches the Close button and Enter calls `onClose`. Live drive confirms in a real browser.
- Criterion 2: CSS review plus live drive screenshots of the focus ring on a layer row, the slider, and the close button.
- Criterion 3: `getByRole('checkbox', { name: 'Airports layer' })` (and Sea Ports, Heatmap) with `toBeChecked`; `getByRole('slider', { name: 'Stress test point count' })` with `aria-valuetext` "0 points" and "500,000 points"; `getByRole('dialog', { name: 'FEATURE INTEL' })`; `getByRole('button', { name: 'Close' })`. Live drive reads the accessibility tree.
- Criterion 4: FeaturePopup tests: on open the dialog has focus; Escape calls `onClose` once; rerender from feature to null returns focus to a button that had focus before open; rerender with a different `onClose` does not move focus back to the dialog; Escape after close does not call `onClose`.
- Criterion 5: Lighthouse JSON after the change, with no failing label/name audits.
- Criterion 6: CSS review; live drive screenshot shows the panel looks unchanged.
- Live drive: `npm run build && npx vite preview`; Tab from page start reaches Airports, Sea Ports, Heatmap (if WebGPU), the slider; focus ring visible on each; Space toggles a layer and the map updates; arrow keys move the slider; click an airport, popup takes focus, Tab to Close shows a focus ring, Escape closes, focus returns.

## Deviations during implementation

- Slider arrow key test: `@testing-library/user-event` 14.6.8 has no keydown behavior for `ArrowRight` on `input[type=range]` (only radios and text selection), and jsdom does not step range inputs either, so a `{ArrowRight}` test could never go green from production code. The LayerPanel test instead dispatches the one-step `change` a browser makes on ArrowRight and asserts `stressCount` 100000 and `aria-valuetext` "100,000 points". Real arrow key stepping is verified in the live drive.
