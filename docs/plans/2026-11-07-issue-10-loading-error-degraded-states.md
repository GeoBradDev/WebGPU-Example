# Plan: No loading, error, or degraded states: failed data loads leave an empty map and SYS NOMINAL (issue #10)

Risk tier: High. Not a forced-High area, but it raises from Low for each of: stateful, interactive UI (retry, live regions, focus) that jsdom only partly exercises; async fetch, WebGPU error scopes and device-loss promises; integration with MapLibre and deck.gl callbacks that only a real browser fires; altering existing behavior (the header, the heatmap row, RENDER); and roughly a dozen files.

Domain skills:
- superpowers:test-driven-development: invoke.
- vercel-react-best-practices: invoke (state from external callbacks, stable callbacks, no set-state in effects, derived state in render).
- chrome-devtools-mcp:a11y-debugging: invoke (new button, live regions, focus after Retry, header status announcements).
- chrome-devtools-mcp:chrome-devtools: invoke for the live drive. If the MCP cannot launch, use Playwright via Node with the cached Chromium (`~/.cache/ms-playwright`).
- frontend-design: not applicable because the new text and button reuse the existing HUD styling (uppercase mono labels, `--accent` bordered buttons like `.gpu-bench-btn`).
- dataviz, django, fastapi, expo, payments, email: not applicable because none of that is touched.

## Decisions (orchestrator, pre-approved)

- Per-layer status in the layer panel: loading text, feature count when loaded, error text with a RETRY button that refetches without a page reload.
- Header status derived from real state: LOADING, NOMINAL, DEGRADED.
- MapLibre `onError` handled for basemap style failures with a visible fallback message.
- A short visible note explains what is unavailable without WebGPU.
- Status changes are announced politely (`aria-live="polite"` / `role="status"`), never as alerts.
- Terse uppercase HUD wording.
- In scope from the issue comments: a render-device failure or a lost render device shows an error state for RENDER and makes the header DEGRADED; a heatmap compute failure, including asynchronous shader or pipeline validation errors, shows the heatmap layer as failed, not loaded.
- WebGPU missing makes the header DEGRADED (the issue lists "SYS NOMINAL even when WebGPU is missing" as a defect).
- Retry must work with whatever fetch `useAirports` does today (issue #9 will change the airports pipeline; do none of its work).

## Acceptance criteria

1. Data layer states. `useAirports` and `usePorts` each return `{ <data>, loaded, error, retry }`. In the layer panel each data layer (AIRPORTS, SEA PORTS) shows a status line under its toggle row:
   - while the request is in flight (initially and after Retry): `LOADING...`;
   - when loaded: the feature count formatted with `toLocaleString('en-US')` followed by ` FEATURES` (for example `84,512 FEATURES`; `0 FEATURES` for an empty file);
   - when failed: `LOAD FAILED`, the error message in the text's `title`, and a `RETRY` button whose accessible name is `Retry <Label>` (for example `Retry Airports`, `Retry Sea Ports`).
2. Retry without reload. Pressing RETRY calls the hook's `retry`, which clears the error, sets the layer back to loading, and issues a new `fetch` of the same URL; on success the count shows and the data reaches the map. No page reload. `retry` is referentially stable across renders. A request superseded by a retry or by unmount never writes state.
3. Focus after Retry. Pressing RETRY moves focus to that layer's checkbox before the button unmounts, so keyboard focus is never dropped to `body`.
4. Heatmap states. `useGPUHeatmap(airports)` returns `{ canvas, computeMs, supported, error, status, retry }` with `status` one of:
   - `unsupported`: `navigator.gpu` is absent (known synchronously at first render) or `requestAdapter()` resolves `null`. `supported` is `false` only in this state.
   - `waiting`: WebGPU is present and `airports` is empty.
   - `computing`: airports are present and the compute for the current attempt has not finished.
   - `ready`: compute finished with no error; `canvas` is the data URL and `computeMs` is set.
   - `error`: any thrown error, any error captured by `pushErrorScope('validation')` or `pushErrorScope('out-of-memory')` (popped after the last readback, in reverse order), or a device loss during the run. `canvas` is `null`. Asynchronous shader or pipeline validation errors land here, never in `ready`.
   The compute still runs once per attempt (once per page load unless retried); `retry` (stable) re-runs it after an error. No set-state synchronously inside an effect (derive `computing` in render if needed). Buffers and the device are still destroyed in `finally`.
   In the layer panel the HEATMAP row is shown whenever `supported` is true (it used to appear only after success) with a status line: `AWAITING AIRPORTS` (heatmap `waiting` while airports load), `NO AIRPORT DATA` (airports failed, or loaded with 0 rows; no extra failure is counted), `COMPUTING...`, `READY`, or `COMPUTE FAILED` with a `RETRY` button named `Retry Heatmap` and the error message in `title`.
5. WebGPU note. When the heatmap is `unsupported`, the HEATMAP row stays hidden and the panel body shows the note `WEBGPU UNAVAILABLE: HEATMAP AND COMPUTE BENCHMARK OFF`.
6. Render device health. RENDER (GPU panel) shows `Failed` (class `err`) when deck.gl reports an error through its `onError` prop before `onDeviceInitialized` has fired (device creation failure), and `Lost` (class `err`) when the initialized device's `lost` promise resolves while the map is mounted (WebGL context loss resolves it). Errors deck reports after the device exists (layer or picking errors) do not change RENDER. A `lost` resolving after unmount changes nothing. `onError` still logs the error with `console.error`. `onError` is passed to the `MapboxOverlay` constructor next to `onDeviceInitialized` (constructor props, not `setProps`, per the existing comment).
7. Basemap failure. MapLibre's `onError` on `<Map>` marks the basemap failed when the event has no `sourceId` and the map has not fired `load` yet (style JSON, sprite, or other style-load failure). Tile and source errors (`sourceId` set) and any error after `load` are ignored. A failed basemap shows a centered, non-interactive (`pointer-events: none`) message in the map area: `BASEMAP UNAVAILABLE` / `DATA LAYERS STILL SHOWN`, with `role="status"`. `onLoad` clears the failure.
8. Header status. A pure `deriveSystemStatus(input)` (new `src/status/systemStatus.js`) returns `{ level, issues }`:
   - input: `{ airports, ports, heatmap, render, basemapFailed }` with `airports`/`ports` in `loading|loaded|error`, `heatmap` in `unsupported|waiting|computing|ready|error`, `render` in `detecting|ready|failed|lost`.
   - `issues` (in this order, only those that apply): `AIRPORTS FAILED`, `PORTS FAILED`, `HEATMAP FAILED`, `WEBGPU UNAVAILABLE`, `RENDER FAILED`, `RENDER LOST`, `BASEMAP FAILED`.
   - `level`: `DEGRADED` if `issues` is non-empty; else `LOADING` if any of: a data layer `loading`, heatmap `waiting` while airports are `loading`, heatmap `computing`, render `detecting`; else `NOMINAL`. Heatmap `waiting` after airports failed is neither loading nor an issue (airports already counts). (Implementation note: heatmap `waiting` counts as loading only while airports are `loading`, so an airports file that loads with 0 features leaves the header NOMINAL instead of LOADING forever.)
   The header shows `SYS <LEVEL>` with the level span class `ok` (NOMINAL), `warn` (LOADING), `err` (DEGRADED). The `.header-status` element has `role="status"` and `aria-live="polite"` and contains, after the level, a visually hidden `: <issues joined by ", ">` when DEGRADED; its `title` is the issues list. No hard-coded NOMINAL remains.
9. Shared health state. The zustand store gains `render: { status, type, renderer }` (initial `{ status: 'detecting', type: null, renderer: null }`) with `setRender`, and `basemapFailed: false` with `setBasemapFailed`; `getInitialState` includes them. MapView writes them from the deck and MapLibre callbacks (no effects) and reads `render` for the GPU panel; App reads them for the header.
10. Narrow screens (issue #5 layout kept). At the narrow breakpoint the header status stays out of the visual layout as today, but is visually hidden (the `.visually-hidden` clip technique) instead of `display: none`, so its live region still announces. The collapsed "Sensor layers" toggle's accessible name becomes `Sensor layers, <n> failed` when n > 0 data or heatmap layers are in `error`, and the toggle shows a visible `<n> FAILED` text (class `panel-alert`) before the chevron.
11. Styling and a11y (issues #4, #7 kept). `.layer-retry` is at least 24x24 (`min-width`/`min-height: 24px`), has a 2px `--accent` `:focus-visible` outline, and reuses the `.gpu-bench-btn` look. Every new rule that declares `color:` is added to `TEXT_PAIRS` in `src/styles.test.js` and passes 4.5:1 (error text uses a token that passes on `overMap`; use `--amber` if `--red` fails). `src/styles.test.js` gains target-size and focus-ring assertions for `.layer-retry`. Status texts and the toggle labels stay inside the 196px (220px narrow) panel without horizontal overflow.
12. Tests (issue AC) cover: the error state of `useAirports` and `usePorts` rendering in the UI (App-level, fetch mocked to fail); Retry from the UI to a loaded count and NOMINAL without remount; the header derivation rules; the MapView `onError` paths (basemap style failure shown, tile error ignored, error after load ignored) and the render paths (`Failed`, `Lost`, lost-after-unmount ignored, post-init error ignored); the heatmap `error` status for an asynchronous validation error from `popErrorScope`, `unsupported` for a null adapter, `ready` on success, and Retry re-running after an error.
13. Prior work preserved: all existing tests pass (fixtures such as hook mocks may gain the new fields; existing assertions are not weakened). README text that this change makes false is updated (the Requirements line about the heatmap toggle, the Known limitations line about RENDER staying `Detecting...` and lost contexts, the small-screen header line).

## Files that change

- `src/hooks/useAirports.js`, `src/hooks/usePorts.js`: add `attempt` state in the effect deps and a stable `retry` (useCallback) that clears `error`, sets `loaded` false, and bumps `attempt` from the event handler. The existing `cancelled` flag guards superseded requests.
- `src/hooks/useAirports.test.js`, `src/hooks/usePorts.test.js`: retry tests.
- `src/hooks/useGPUHeatmap.js`: status model, error scopes, device-loss race, adapter-null as unsupported, `attempt` + `retry` replacing the `hasRun` ref semantics (one run per attempt).
- `src/hooks/useGPUHeatmap.errors.test.js` (new): fake `navigator.gpu` device; stub `GPUBufferUsage`, `GPUMapMode`, `ImageData`, and `HTMLCanvasElement.prototype.getContext`/`toDataURL` as needed; restore after.
- `src/hooks/useGPUHeatmap.asyncValidation.test.js` (new): the frozen defect reproduction (an asynchronous validation error popped from an error scope must give `status: 'error'` and `canvas: null`), kept in its own self-contained file so the frozen test is never edited while the other heatmap tests grow.
- `src/status/systemStatus.js` (new) and `src/status/systemStatus.test.js` (new).
- `src/store/mapStore.js` (+ `src/store/mapStore.test.js`): `render`, `setRender`, `basemapFailed`, `setBasemapFailed`.
- `src/components/gpuLabels.js` (+ test): `renderBackendLabel(deviceType, status)` returns `{ text: 'Failed' | 'Lost', ok: false, err: true }` for those statuses; existing behavior unchanged otherwise.
- `src/components/GPUInfoPanel.jsx`: RENDER class `err` when the label says so; reads `capabilities.renderStatus`.
- `src/components/MapView.jsx`: `onError` for deck (constructor props), `device.lost` subscription guarded by a device ref cleared on unmount, MapLibre `onError`/`onLoad`, the basemap fallback element; reads/writes the store.
- `src/components/MapView.health.test.jsx` (new): mocks like `MapView.test.jsx` but the `Map` mock captures its props so the test can fire `onError`/`onLoad`.
- `src/components/LayerPanel.jsx`: new optional `status` prop `{ airports, ports, heatmap }`, each `{ status, count?, error?, onRetry? }`; per-layer status line (`.layer-status`, text span with a visually hidden `<Label>: ` prefix and `aria-live="polite"`), RETRY button (`.layer-retry`), WebGPU note (`.layer-note`), narrow toggle alert. `heatmapSupported` prop kept. Without `status`, rows render exactly as before.
- `src/components/LayerPanel.status.test.jsx` (new).
- `src/App.jsx`: Header takes the derived status; App builds the `status` prop from the hooks and passes `retry` handlers; heatmap `waiting` maps to `NO AIRPORT DATA` (status `blocked` in the panel) when airports failed or loaded with 0 rows.
- `src/App.test.jsx`: heatmap mock gains `status: 'unsupported'`, `retry`; assertions unchanged.
- `src/App.status.test.jsx` (new): App-level failure, retry, and header tests.
- `src/App.header.test.jsx` (new): header markup (`role="status"`, `aria-live`, level classes, hidden issues text, `title`) and the heatmap, render, and basemap wiring. Split from `src/App.status.test.jsx` because that file is the frozen defect reproduction and is never edited after it is committed red.
- `src/index.css`: `.header-status .err`, `.layer-status`, `.layer-status-error` text, `.layer-retry` (+ hover, focus-visible), `.layer-note`, `.panel-alert`, `.basemap-fallback`; narrow block: header status visually hidden instead of `display: none`.
- `src/styles.test.js`: `TEXT_PAIRS` additions, `.layer-retry` target-size and focus-ring tests.
- `README.md`: lines AC13 names.

## Order of work

1. Store fields + `deriveSystemStatus` (pure, test first).
2. `useAirports` / `usePorts` retry (test first).
3. `gpuLabels` Failed/Lost, GPUInfoPanel class (test first).
4. MapView deck `onError`, `device.lost`, MapLibre `onError`/`onLoad`, fallback (test first).
5. `useGPUHeatmap` status, error scopes, retry (test first; the async validation case is the defect from the second issue comment: freeze it).
6. LayerPanel status UI, retry focus, note, narrow alert (test first).
7. App wiring + header (App-level tests first: the issue's reproduction is the defect: freeze it).
8. CSS + styles tests; README.
9. Gate, live drive.

## Risks

- MapLibre also fires `error` for sprite or glyph failures; the before-`load` rule may flag a basemap that partly drew. Accepted: if the style JSON loads but its sprite fails before `load`, the message shows until `onLoad` clears it.
- deck's `onError` receives non-device errors too; only pre-init errors mark RENDER failed.
- luma.gl resolves `device.lost` on our own unmount/destroy (reason `destroyed`) and on context loss (also reason `destroyed`), so the unmount guard, not the reason, separates them.
- The heatmap row now appears before success; a WebGPU browser with no adapter shows `AWAITING AIRPORTS`/`COMPUTING...` until `requestAdapter` resolves `null`, then the row hides and the note shows.
- LOADING includes render `detecting`; a deck that never calls back or errors leaves LOADING. Accepted: that is the truth.
- Live regions inside the collapsed narrow panel body (`hidden`) do not announce; the header status (visually hidden, not `display: none`) covers that.
- Not done: retry for the basemap; caching or worker parsing for airports (issue #9).

## Proof

- AC1, AC2, AC3, AC12: `src/App.status.test.jsx` (airports failure shows `LOAD FAILED` + `Retry Airports` + `SYS DEGRADED`; ports likewise; Retry with fetch now succeeding shows `1 FEATURES` and `SYS NOMINAL` with the same App instance and two fetch calls for the URL; focus lands on the checkbox), `src/components/LayerPanel.status.test.jsx`, hook retry tests.
- AC4: `src/hooks/useGPUHeatmap.asyncValidation.test.js` (frozen defect), `src/hooks/useGPUHeatmap.errors.test.js`.
- AC5, AC10, AC11: `LayerPanel.status.test.jsx`, `src/styles.test.js`.
- AC6, AC7: `src/components/MapView.health.test.jsx`, `gpuLabels.test.js`.
- AC8, AC9: `src/status/systemStatus.test.js`, `src/store/mapStore.test.js`.
- AC13: full gate.
- Live drive (`npm run build && npm run preview`, Playwright Chromium): with `raw.githubusercontent.com` aborted, AIRPORTS shows `LOAD FAILED` + RETRY and the header `SYS DEGRADED`; unblock, press RETRY: a count and `SYS NOMINAL` (with a WebGPU adapter: `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`), no navigation (same `performance.timeOrigin`/a window marker survives). With `basemaps.cartocdn.com` aborted: the basemap message and DEGRADED. Screenshots at 375x812 (panel expanded), 768x1024, 1440x900 with an error and a RETRY button visible: nothing overflows the panel, no overlap with the header, GPU panel, or popup; RETRY measures at least 24x24 and shows a focus ring on keyboard focus.
