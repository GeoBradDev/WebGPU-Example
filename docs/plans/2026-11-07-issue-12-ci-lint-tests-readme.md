# Plan: No CI; lint fails on main; core hooks and components untested; README is the Vite template (issue #12)

Risk tier: Medium. Mostly additive (CI, tests, docs), but the stress-point generation moves from a render-time `useMemo` to a debounced effect, which changes existing stateful UI behavior that unit tests only partly exercise.

Domain skills:
- vercel-react-best-practices: invoke (React hook refactor for useStressPoints, effect and debounce pattern).
- superpowers:test-driven-development: invoke.
- frontend-design, dataviz, django, fastapi, expo, payments, email: not applicable because no UI design, chart, backend, mobile, payment, or email work is in scope.

## Acceptance criteria

1. `.github/workflows/ci.yml` exists, triggers on `push` to `main` and on `pull_request`, and has a single job with id and name `ci` running on `ubuntu-latest` with Node LTS (`actions/setup-node` `node-version: lts/*`, `cache: npm`) that runs, in order: `npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high`. Actions are pinned to major versions (`actions/checkout@v7`, `actions/setup-node@v7`). The job is green on this PR, including `src/config/maplibreWorker.test.js` (a real `vite build`).
2. `npm run lint` exits 0 with zero errors on this branch. No `eslint-disable` comment and no rule configuration change is added to achieve it.
3. `useStressPoints` calls no impure function during render: points are generated inside a debounced effect timer (default 150 ms) and stored in state. Rapid count changes within the debounce window generate points once, for the last count only. Count 0 clears to the empty object. The returned shape (`{ stressPoints }` with `length` and `attributes.getPosition { value: Float32Array(count*3), size: 3 }`) is unchanged, so `buildLayers` and `MapView` need no change.
4. Tests exist and pass for: `usePorts` (success parse, non-OK response error, network rejection error); `useGPUCapabilities` (no `navigator.gpu`, `requestAdapter` resolves null, plus a success case); `App` render smoke test with `MapView` and WebGPU hooks mocked and `fetch` stubbed; the new `useStressPoints` behavior (debounce, single generation, clear on 0, value ranges).
5. `README.md` replaces the Vite template with: purpose, browser and WebGPU requirements, setup from a clean clone, scripts, data sources and licenses, known limitations.
6. A repo-root `CLAUDE.md` documents the gate commands, JavaScript only (no TypeScript), no emojis, no em dashes, and has a `## Git exception` section scoped to `issue-<N>-*` branches as specified by the user.
7. The workgroup-count overflow from the issue is already fixed on `main` (`src/hooks/useGPUCompute.js` lines 3 to 5 dispatch exactly 65,535 workgroups); no change there.

## Files that change

- `src/hooks/useStressPoints.js`: export a pure-by-argument `generateStressPoints(count, random = Math.random)` helper; the hook holds `stressPoints` in `useState(EMPTY)` and in a `useEffect` keyed on `[count, delayMs]` schedules `setTimeout(() => setStressPoints(count > 0 ? generateStressPoints(count) : EMPTY), delayMs)`, clearing the timer in cleanup. Signature `useStressPoints(count, { delayMs = 150 } = {})`. Setting state only inside the timer callback keeps `react-hooks/set-state-in-effect` quiet.
- `src/hooks/useStressPoints.test.js`: rewrite around fake timers (`vi.useFakeTimers`, `act(() => vi.advanceTimersByTime(...))`).
- `src/hooks/usePorts.test.js` (new).
- `src/hooks/useGPUCapabilities.test.js` (new): stub `navigator.gpu` with `vi.stubGlobal` or `Object.defineProperty` and restore after each test.
- `src/App.test.jsx` (new): `vi.mock('./components/MapView.jsx', ...)` to a stub, mock `./hooks/useGPUHeatmap.js` to return `{ canvas: null, computeMs: 0, supported: false }`, stub `fetch` to resolve empty data for airports CSV and ports GeoJSON; assert header title "WebGPU Groundtruth", the layer panel, and the stub map render. Reset the zustand store between tests if state is touched.
- `.github/workflows/ci.yml` (new).
- `README.md` (rewrite).
- `CLAUDE.md` (new).
- `docs/plans/2026-11-07-issue-12-ci-lint-tests-readme.md` (this file).

## Order of work

1. Red: rewrite `useStressPoints.test.js` to the new debounced contract; run it and confirm failure (the current hook returns points synchronously, so the "empty before debounce" and "single generation" tests fail). Commit the red test alone.
2. Green: change `useStressPoints.js`. Run `npm run lint` and `npm test`.
3. Add `usePorts.test.js`, `useGPUCapabilities.test.js`, `App.test.jsx` (characterization tests of existing behavior; they should pass on first run, so confirm each one can fail by temporarily breaking an assertion locally, not committed).
4. Add `.github/workflows/ci.yml`.
5. Rewrite `README.md`; add `CLAUDE.md`.
6. Full gate, then live drive.

## Risks

- Debounced generation delays points by 150 ms after the slider stops; intended. Slider label still updates immediately from the store.
- Setting the slider back to 0 now clears after the debounce, not instantly. Acceptable; tested.
- A 5M-point generation still blocks the main thread once (about 85 ms) after the user settles. Moving it to a worker is out of scope.
- `App.test.jsx` must not import maplibre or deck.gl (jsdom has no WebGL); mocking `MapView.jsx` prevents that.
- The CI `vite build` inside the test may be slow on runners; it already has a 120 s timeout.
- Chose not to: add a worker for generation, change the slider to commit-on-release, touch `useGPUCompute.js` (issue #11 reworks it), or remove the existing `eslint-disable-next-line react-hooks/purity` in `MapView.jsx` (out of scope; reported).

## Proof

- Criterion 1: workflow file review, plus the CI run on this PR green.
- Criterion 2: `npm run lint` output with zero problems.
- Criterion 3: `useStressPoints.test.js` (debounce, single generation via a `Math.random` spy call count, clear on 0, ranges), and the live drive.
- Criterion 4: the new test files passing in `npm test`.
- Criteria 5 and 6: file review.
- Criterion 7: `grep` of `useGPUCompute.js`.
- Live drive: `npm run build && npx vite preview`; the map renders; moving the stress slider to a non-zero value shows the point count update in the GPU info panel and points draw; moving back to 0 clears them; no console errors from the change.
