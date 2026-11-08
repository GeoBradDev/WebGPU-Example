# Plan: GPU panel shows RENDER WebGPU while deck.gl is actually rendering with WebGL2 (issue #8)

Risk tier: High. Not a forced-High area, but it raises two tiers from Low: the render backend comes from deck.gl's device initialization inside a MapLibre control, which jsdom cannot exercise (integration), and it alters existing behavior (RENDER no longer derives from the WebGPU adapter probe). Five or six files change.

Domain skills:
- superpowers:test-driven-development: invoke.
- vercel-react-best-practices: invoke (state from an external callback, stable callbacks, no work in render).
- chrome-devtools-mcp:chrome-devtools: invoke for the live drive. If the chrome-devtools MCP fails (locked profile), use Playwright via `npx playwright` with the cached Chromium instead.
- chrome-devtools-mcp:a11y-debugging: not applicable because no control, focus order, or accessible name changes; only visible text of two values and one key changes.
- frontend-design: not applicable because the panel keeps its existing HUD styling.
- dataviz, django, fastapi, expo, payments, email: not applicable because none of that is touched.

## Decision (user)

Report the truth. Do not wire WebGPU rendering. RENDER reads the device type deck.gl actually created. WebGPU compute availability (the `useGPUCapabilities` tier) stays separate and only gates the compute readout.

## Acceptance criteria

1. RENDER shows the backend deck.gl actually uses: the luma.gl device type passed to deck's `onDeviceInitialized` callback. `webgl` (luma.gl's WebGL2 device; `webgl2` is accepted as an alias) shows `WebGL2`, `webgpu` shows `WebGPU`. Before deck has initialized its device, RENDER shows `Detecting...`. Any other non-empty type shows `Unknown`, including names of `Object.prototype` members such as `__proto__`, `toString`, and `constructor` (the lookup is a `Map`, not a plain object).
2. The WebGPU adapter tier (`webgpu`, `no-webgpu`, `unknown`) never decides the RENDER text. With tier `webgpu` and a `webgl` device, RENDER shows `WebGL2`. The strings `WebGL Fallback` and the tier-derived `WebGPU` RENDER label are gone.
3. RENDER value class: `ok` when the device type is `webgl`/`webgl2`/`webgpu`, `warn` while detecting or unknown.
4. The compute item's key reads `WEBGPU COMPUTE` (was `COMPUTE`), so WebGPU compute availability reads apart from RENDER. Its behavior from #11 is unchanged: `--` and no RUN button unless the tier is `webgpu` and the benchmark is supported; the RUN button's accessible name stays `Run compute benchmark`; the value stays a polite live region.
5. GPU label, in order: adapter `device`, then adapter `description`; if both are empty, adapter `vendor` and `architecture` joined with a space (either alone if only one is set); if the adapter offers none of those, the render device's `info.renderer` from deck's device (luma.gl `device.info.renderer`, the unmasked WebGL renderer string when exposed); otherwise `Unknown`. The GPU value carries class `gpu-info-name`, which truncates it with an ellipsis at 32ch, and a `title` attribute with the full name, because the renderer string can be about 90 characters. The panel keeps `pointer-events: none`; `.gpu-info-name` sets `pointer-events: auto` so the title tooltip shows on hover.
6. Unit tests cover: RENDER for `webgl`, `webgl2`, and `webgpu` device types; the not-yet-initialized state (`Detecting...`); an unrecognized type; tier `webgpu` with device `webgl` still showing `WebGL2`; each GPU label fallback step. A MapView wiring test (with `react-map-gl/maplibre`, `@deck.gl/mapbox`, and the GPU hooks mocked) shows `Detecting...` first, then `WebGL2` after the overlay's `onDeviceInitialized` is called with `{ type: 'webgl' }`, proving the callback is passed to the `MapboxOverlay` constructor.
7. Prior work preserved: all other existing tests pass; tests that looked up the `COMPUTE` key text are updated only for the new key text. At 1024px wide or less the panel shows only RENDER, PTS, FRAME. At 375x812, 768x1024, and 1440x900 the panel stays inside the viewport and does not overlap the header, the layer panel, or an open popup at 768. At every width over 1024px the panel does not overlap an open feature popup whatever the GPU label length: the panel's top-level `max-width` is `calc(100vw - 340px)` (the 1024px rule already used it; the 640px narrow rule keeps `calc(100vw - 32px)`). Because that cap can wrap the panel above 1024px, the `|` separators are hidden at every width (kept in the DOM) and items are spaced by `column-gap: 14px`, as #5 already did at 1024px and below, so a wrapped row never starts or ends with a separator. No new `color:` rule unless it is added to `src/styles.test.js`'s `TEXT_PAIRS`.
8. README's GPU info panel bullet and Requirements text describe RENDER as the deck.gl backend (`WebGL2`, `WebGPU`, or `Detecting...`) and no longer say the panel shows `WebGL Fallback`; references to the COMPUTE key use `WEBGPU COMPUTE`.

## Files that change

- `src/components/gpuLabels.js` (new): pure helpers `renderBackendLabel(deviceType)` returning `{ text, ok }` (or two functions, implementer's choice), and `gpuDeviceLabel(adapterInfo, renderInfo)`. No React.
- `src/components/gpuLabels.test.js` (new): unit tests for both helpers (AC1, AC5).
- `src/components/gpuLabels.protoKeys.test.js` (new, review fix B1): `renderBackendLabel` returns `Unknown`, not ok, for prototype member names (AC1).
- `src/index.css` (review fix B2): new `.gpu-info-name` rule (nowrap, hidden overflow, ellipsis, `max-width: 32ch`, no `color:`), and the top-level `.gpu-info-panel` `max-width` becomes `calc(100vw - 340px)`.
- `src/index.css` (review fix F2): top-level `.gpu-info-sep` gets `display: none` and `.gpu-info-panel` gets `column-gap: 14px`.
- `src/styles.gpuSeparators.test.js` (new, review fix F2): asserts both top-level declarations.
- `src/styles.gpuPanel.test.js` (new, review fix F1): the panel keeps `pointer-events: none` and `.gpu-info-name` has `pointer-events: auto`.
- `src/styles.test.js` (review fix B2): asserts the `.gpu-info-name` declarations, the top-level panel `max-width`, and that the 1024px and 640px panel widths from #5 are unchanged.
- `src/components/GPUInfoPanel.gpuName.test.jsx` (new, review fix B2): the GPU value has class `gpu-info-name` and the full name in `title`.
- `src/components/GPUInfoPanel.jsx`: read `renderDevice` from `capabilities` (`{ type, renderer }` or null/undefined; must be optional so existing tests that omit it render `Detecting...`). RENDER text and class from `renderBackendLabel(renderDevice?.type)`. GPU text from `gpuDeviceLabel(adapterInfo, renderDevice)`, in a value span with class `gpu-info-name` and `title` set to the full name. Compute key text `WEBGPU COMPUTE`. `isWebGPU` (tier) keeps gating only the RUN button.
- `src/components/GPUInfoPanel.test.jsx` and `src/components/GPUInfoPanel.benchmarkTier.test.jsx`: change `getByText('COMPUTE')` lookups and the `'COMPUTE'` entry in the secondary-key loop to `'WEBGPU COMPUTE'`; add panel tests for AC1 to AC3 (incl. tier `webgpu` + device `webgl`).
- `src/components/MapView.jsx`: `const [renderDevice, setRenderDevice] = useState(null)`. A stable `useCallback` `(device) => setRenderDevice({ type: device.type, renderer: device.info?.renderer })`. `DeckGLOverlay` takes `onDeviceInitialized` and passes it in the `MapboxOverlay` constructor props (the overlay creates its `Deck` in `onAdd` from those props, so it must be there at construction; `setProps({ layers })` keeps it). Add `renderDevice` to the `capabilities` memo and its deps.
- `src/components/MapView.test.jsx` (new): wiring test of AC6. Mock `react-map-gl/maplibre` (`Map` renders children; `useControl(factory)` calls the factory once and returns its result), mock `@deck.gl/mapbox` `MapboxOverlay` as a class that records its constructor props and has `setProps`, mock `maplibre-gl/dist/maplibre-gl.css` and `../config/maplibreWorker.js` if needed, mock `useGPUCapabilities` and `useGPUCompute`. Call the recorded `onDeviceInitialized` inside `act` and assert RENDER.
- `README.md`: AC8, plus the GPU name truncation and hover in the panel bullet and a Known limitations line that RENDER is not updated after deck reports its device (device creation failure stays `Detecting...`, context loss is not reflected).

## Order of work

1. Red: `gpuLabels.test.js`, then the helpers.
2. Red: panel tests (new RENDER cases, renamed key), then `GPUInfoPanel.jsx`.
3. Red: `MapView.test.jsx`, then `MapView.jsx`.
4. README.
5. Gate, then live drive.

## Risks

- `onDeviceInitialized` must be in the constructor props; passing it only through `setProps` after `onAdd` would miss the event. The wiring test asserts constructor props.
- React StrictMode double-invokes effects; `useControl` may create the overlay twice in dev. The callback only sets state, so a repeated call is harmless.
- If deck's device creation fails, RENDER stays `Detecting...`. Loading and error states are issue #10; not handled here (noted in the PR).
- Longer key text `WEBGPU COMPUTE` widens the panel at widths over 1024px; re-measure at 1440.
- luma.gl's WebGL device type string is `webgl`, not `webgl2`; the label maps both.

## Not done

- WebGPU rendering (`deviceProps: { type: 'webgpu' }`): rejected by the user.
- Header "SYS NOMINAL" and loading/error states: issue #10.

## Proof

- AC1, AC3, AC5: `src/components/gpuLabels.test.js`, `src/components/gpuLabels.protoKeys.test.js`, and the new panel tests.
- AC2: panel test with tier `webgpu` and device `webgl`.
- AC4, AC7: existing panel and benchmark tier tests (key text updated), `src/styles.test.js`.
- AC5 truncation, tooltip, and AC7 popup clearance: `src/components/GPUInfoPanel.gpuName.test.jsx`, `src/styles.test.js`, `src/styles.gpuPanel.test.js`, and `src/styles.gpuSeparators.test.js`; live drive at 1440x900, 1280x800, and 1025x800 checks no separator is visible; live drive at 1440x900 and 1025x800 with a feature popup open measures the panel and popup rects.
- AC6: `src/components/MapView.test.jsx`.
- Live drive: `npm run build && npm run preview`; in the browser RENDER shows `WebGL2`, and the console shows the deck canvas holds a `webgl2` context (for example `[...document.querySelectorAll('canvas')].map(c => !!c.getContext('webgl2'))` all true, and no `webgpu` context) matching the label. Note: headless Chromium has no WebGPU adapter and the user's Chrome returns null from `requestAdapter()`, so the tier is `no-webgpu` there; WEBGPU COMPUTE shows `--` with no RUN button. GPU label shows the WebGL renderer string when the adapter offers nothing. Re-measure layout at 375x812, 768x1024, 1440x900.
