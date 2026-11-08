# Plan: GPU compute benchmark runs a 64 MB dispatch every second indefinitely (issue #11)

Risk tier: High. Not a forced-High area, but it raises three tiers: stateful UI with a new interactive control (not fully provable in jsdom), it alters existing behavior (continuous readout becomes on-demand), and it is async GPU lifecycle code (run, cancel, unmount, visibility). About six files change.

Domain skills:
- superpowers:test-driven-development: invoke.
- vercel-react-best-practices: invoke (hook state, effect cleanup, stable callbacks, no work in render).
- chrome-devtools-mcp:a11y-debugging: invoke for the live drive (button name, focus ring, target size, live region). If the chrome-devtools MCP fails (locked profile), use Playwright via `npx playwright` with the cached Chromium instead.
- frontend-design: not applicable because the control must follow the existing HUD styling of the GPU panel; no new visual direction.
- dataviz, django, fastapi, expo, payments, email: not applicable because none of that is touched.

## Acceptance criteria

1. No benchmark GPU work on mount: `useGPUCompute` calls neither `navigator.gpu.requestAdapter`, `requestDevice`, `createBuffer`, nor `queue.submit`. Nothing is allocated for the benchmark until the user activates the "Run benchmark" control. (The map's existing `useGPUCapabilities` adapter probe and the one-shot `useGPUHeatmap` run are unchanged and out of scope.)
2. The GPU info panel's COMPUTE item contains a native `<button>` with visible text `RUN` and accessible name `Run compute benchmark`. It is reachable with Tab, activates with Enter and Space, has the same 2px `--accent` `:focus-visible` ring style as the other controls, and is at least 24x24 CSS px. It accepts pointer input although `.gpu-info-panel` has `pointer-events: none`.
3. A run requests one adapter and one device, allocates the 64 MB storage buffer once, then performs exactly `BENCHMARK_DISPATCHES` (5) dispatches strictly in sequence: dispatch k+1 is not submitted until `queue.onSubmittedWorkDone()` for dispatch k has resolved. No `setInterval`; nothing is scheduled after the run.
4. A run that completes shows the median of the 5 timings as `~X.X GB/s est.` (128 MB traffic per dispatch, CPU timed, so labelled as an estimate). When the median is not a positive finite number (a coarse `performance.now()` can make it 0), it shows `Too fast` instead of `~Infinity GB/s est.`.
5. After every run, completed, stopped, or failed, `buffer.destroy()` and `device.destroy()` are called, so the 64 MB buffer and the device are held only for the run's duration.
6. No GPU work while the tab is hidden: activating the control while `document.visibilityState === 'hidden'` does nothing; if the tab becomes hidden mid-run, no further dispatch is submitted (the one in flight is allowed to finish), the resources are destroyed, and COMPUTE shows `Stopped`. This includes setup: hidden while `requestAdapter()` or `requestDevice()` is pending means the run bails right after that await, before the buffer is allocated, destroys a device that arrives late, and shows `Stopped`.
7. Runs never overlap: activating the control while a run is in progress does nothing. While running, the button has `aria-disabled="true"` (not `disabled`, so focus is not lost) and COMPUTE shows `Running...`.
8. Unmount mid-run: the run stops before its next dispatch (or, during setup, before the buffer is allocated), the buffer and device are destroyed (a device that arrives after unmount is destroyed when it arrives), and state setters are skipped after unmount (mounted ref). `run()` called after unmount does nothing.
9. Results are announced: the COMPUTE value is a polite live region (`aria-live="polite"`), so `Running...`, the result, `Stopped`, and `Failed` are read by screen readers.
10. When WebGPU is unavailable (`navigator.gpu` undefined, or `requestAdapter()` returns null), the button is absent and COMPUTE shows `--`, as today. Because `useGPUCompute` may not probe an adapter on mount (AC1), the panel also requires the RENDER tier from `useGPUCapabilities` to be `webgpu` before it shows the button, so a browser that exposes `navigator.gpu` with no adapter (headless Chromium does) never shows it; the button is also hidden while the tier is `unknown`. A run that throws for any other reason shows `Failed` and destroys whatever it allocated; the button stays so the user can retry.
11. Prior work preserved: all existing tests pass unchanged. At 1024px wide or less the panel still shows only RENDER, PTS, FRAME (the button lives inside the secondary COMPUTE item and hides with it). At 375x812, 768x1024, and 1440x900: header elements do not overlap pairwise; `.app-header`, `.layer-panel`, `.gpu-info-panel`, and an open `.feature-popup` stay inside the viewport; popup and GPU panel do not overlap at 768. Every new `color:` rule is in `src/styles.test.js`'s `TEXT_PAIRS` and passes 4.5:1.
12. README's GPU info panel bullet and Known limitations no longer say the benchmark runs every second.

## Decisions

- On-demand, not continuous (user decision). 5 dispatches, median, CPU timing, labelled `est.`. `timestamp-query` is not used: it needs an optional feature, a query set, a resolve buffer, and a map-read round trip, which is not trivial here.
- Device per run, destroyed after. Sharing one `GPUDevice` with `useGPUHeatmap` is not done: the heatmap is one-shot and already destroys its device in `finally`, and the benchmark device now lives only for a user-started run, so a shared long-lived device would hold GPU resources longer than either hook does now. Noted in the PR.
- The control is hidden at 1024px and below with the rest of COMPUTE. #5 fixed that panel to RENDER, PTS, FRAME and sized it to clear the 288px popup; the 64 MB benchmark is also the least appropriate on phones and tablets.
- Mid-run hide sets a stop flag only; destroying the device while `onSubmittedWorkDone()` is pending is not relied on to settle that promise. Unmount sets the flag and also destroys the resources immediately (idempotent), since nothing waits on the UI afterwards.

## Files that change

- `src/hooks/useGPUCompute.js`: rewrite. Export `BENCHMARK_DISPATCHES = 5`, pure helpers `median(values)` and `formatThroughput(seconds)` (returns `~X.X GB/s est.`). Hook returns `{ throughput, supported, running, run }`. Initial state: `supported = Boolean(navigator.gpu)`, `throughput: '--'`, `running: false`; no effect does GPU work. `run` (stable `useCallback`): returns early when a run is active (ref, not state) or the document is hidden; otherwise sets `running`, `Running...`, requests adapter (null -> `supported: false`, `--`), device, buffer (mappedAtCreation, fill 1.0), pipeline, bind group; loop 5 times: check stop flag, encode, submit, `await onSubmittedWorkDone()`, record CPU elapsed; check stop flag again. A `visibilitychange` listener added for the run's duration sets the stop flag when hidden; removed in `finally`. `finally` destroys buffer and device and clears the active ref. State setters are skipped after unmount (mounted ref). An unmount effect sets the stop flag and destroys any live resources.
- `src/hooks/useGPUCompute.test.js`: keep the existing fallback test; add tests with a mocked `navigator.gpu` (stub `navigator.gpu`, `GPUBufferUsage`, `GPUShaderStage` if used) whose `onSubmittedWorkDone` returns controllable deferred promises.
- `src/components/GPUInfoPanel.jsx`: new props `benchmark = { supported, running, onRun }` (separate from `capabilities`). COMPUTE value gets `aria-live="polite"`; when `benchmark.supported` and the tier is `webgpu` render `<button type="button" className="gpu-bench-btn" aria-label="Run compute benchmark" aria-disabled={running ? 'true' : undefined} onClick={...}>RUN</button>` that ignores clicks while running.
- `src/components/GPUInfoPanel.test.jsx`: add tests (button present/absent, name, click and keyboard activation via user-event, aria-disabled while running and no call, live region). Existing tests unchanged; they render without the new prop, so the prop must be optional.
- `src/components/MapView.jsx`: pass `benchmark={{ supported, running, onRun: run }}` from `useGPUCompute()`; memoize it.
- `src/index.css`: `.gpu-bench-btn` (pointer-events: auto; min-width and min-height 24px; background none; 1px `--border-active` border; `color: var(--accent)`; font inherit; cursor pointer), `.gpu-bench-btn:hover`, `.gpu-bench-btn:focus-visible` (2px solid `--accent`, offset 2px), `.gpu-bench-btn[aria-disabled='true']` (`color: var(--text-dim)`, cursor default). Only add `color:` rules you also add to `TEXT_PAIRS`.
- `src/styles.test.js`: add the new `color:` selectors to `TEXT_PAIRS` (bg `overMap`) and a 24x24 target-size assertion for `.gpu-bench-btn`.
- `README.md`: GPU info panel bullet and the Known limitations line about the benchmark.

## Order of work

1. Pure helpers (`median`, `formatThroughput`) with tests.
2. Hook tests red, then the hook: no work on mount; sequential dispatches; destroy after; hidden before and mid-run; overlap guard; unmount mid-run; no adapter; failure path.
3. Panel tests red, then the panel and MapView wiring.
4. CSS and the styles test table.
5. README.
6. Gate, then the live drive.

## Risks

- A stuck `running` state (a promise that never settles) would leave the button permanently disabled. Mitigation: never destroy the device on hide while awaiting; `finally` always clears.
- Layout: the 24px button grows the wide panel's height. It is bottom-right at `bottom: 40px`; check it still clears the layer panel and attribution at 1440x900.
- `.gpu-info-panel` has `pointer-events: none`; forgetting `pointer-events: auto` on the button makes it unclickable with a mouse while still passing keyboard tests.
- Existing `GPUInfoPanel` tests render without `benchmark`; the prop must default safely.

## Proof

- AC1, 3, 5, 6, 7, 8, 10: `src/hooks/useGPUCompute.test.js` with mocked `navigator.gpu`: no calls on mount; 5 submits, each only after the previous `onSubmittedWorkDone` resolves (submit count checked while a deferred is pending); `buffer.destroy` and `device.destroy` called after completion, after stop, and after a throw; hidden before run means `requestAdapter` not called; hidden mid-run stops at the next dispatch and shows `Stopped`; second `run()` during a run does not request a second adapter; unmount mid-run destroys and further deferred resolution submits nothing (React 19 does not warn on a state update after unmount, so the mounted-ref guard is reviewed, not asserted); `src/hooks/useGPUCompute.setupStop.test.js`: hidden during pending `requestAdapter` or `requestDevice`, and unmount during pending `requestDevice`, never call `createBuffer` and destroy a late device, and `run()` after unmount requests no adapter; null adapter gives `supported: false` and `--`.
- AC4: helper tests (`median`, `formatThroughput`) and a full-run test asserting the `~X.X GB/s est.` value; `src/hooks/useGPUCompute.tooFast.test.js`: `formatThroughput` of 0, negative, NaN, or Infinity is `Too fast`, and a run with a frozen `performance.now` shows `Too fast`.
- AC2, 7, 9, 10: `src/components/GPUInfoPanel.test.jsx`; the tier gate in AC10 (found in the live drive) in `src/components/GPUInfoPanel.benchmarkTier.test.jsx`.
- AC11: `src/styles.test.js` table and target size; existing suite unchanged.
- Live drive (build + `npm run preview`, Playwright or chrome-devtools): headless Chromium has no WebGPU, so (a) confirm the no-WebGPU state: no button, COMPUTE `--`; (b) inject a mock `navigator.gpu` with an init script and drive a run by Tab plus Enter and by mouse click: `Running...`, then `~X GB/s est.`, aria-disabled while running, focus ring visible, button box at least 24x24; (c) edge paths with the mock: hide the tab mid-run (override `visibilityState` and dispatch `visibilitychange`) shows `Stopped`; double activation runs once; (d) measure layout at 375x812, 768x1024, 1440x900 per AC11, including the button's box at 1440 and its absence at 768 and 375. If the user's real Chrome (claude-in-chrome) has WebGPU, try a real run and record the number.
