# WebGPU Performance Demo Design

**Date:** 2026-03-12
**Status:** Approved

## Overview

Add two integrated performance features to the existing WebGPU Groundtruth map application that demonstrate WebGPU's capabilities to technical software engineer audiences:

1. A stress test slider that renders up to 1,000,000 synthetic points on the map
2. A GPU compute benchmark that measures memory bandwidth via a compute shader
3. A rolling frame-time sparkline replacing the single frame time number

All features are integrated into the existing map view with no mode switching.

## Architecture

### New files

**`src/hooks/useStressPoints.js`**

Accepts `count` (number). Uses `useMemo` to generate a deck.gl binary columnar object:
```
{ length: count, attributes: { getPosition: { value: Float32Array, size: 3 } } }
```
The `Float32Array` contains `count * 3` values: random `[lon, lat, 0]` coordinates distributed globally. Returns an empty object when count is 0. No side effects, no network calls.

**`src/hooks/useGPUCompute.js`**

Initializes a WebGPU compute pipeline on mount. Behavior:

1. Request adapter + device via `navigator.gpu`. If unavailable, return `{ throughput: '--', supported: false }` immediately.
2. Allocate a 64MB storage buffer (16M floats) pre-filled with `1.0`.
3. Compile a WGSL compute shader with workgroup size 256 that performs element-wise multiply-accumulate: `buf[i] *= 1.0000001`. This is a read-modify-write on every element, producing 128MB of memory traffic per dispatch.
4. On a 1-second interval: record a command buffer, submit, `await device.queue.onSubmittedWorkDone()`, measure wall-clock delta, compute `throughput = 0.128 / elapsedSeconds` in GB/s.
5. Returns `{ throughput: '450 GB/s', supported: true }`.
6. Cleans up buffer and device on unmount.

Falls back silently on any error. Does not compete visibly with the render loop.

### Modified files

**`src/store/mapStore.js`**

Add `stressCount: 0` to `initialState`. Add `setStressCount: (count) => set({ stressCount: count })` action alongside the existing actions.

**`src/hooks/useGPUCapabilities.js`** (no change needed - capabilities are composed in MapView)

**`src/components/MapView.jsx`**

`useFrameTime` updated to accumulate a `frameHistory` array capped at 60 entries (using a ref alongside the existing `lastRef`). Returns `{ frameTime, frameHistory }` instead of just `frameTime`.

`MapView` calls `useGPUCompute()` and destructures `{ throughput: gpuThroughput }`. The `capabilities` object passed to `GPUInfoPanel` is extended to include `frameHistory` and `gpuThroughput`:

```js
const capabilities = useMemo(
  () => ({ ...gpuBase, activePointCount, frameTime, frameHistory, gpuThroughput }),
  [gpuBase, activePointCount, frameTime, frameHistory, gpuThroughput]
)
```

**`src/layers/index.js`**

`buildLayers` signature updated: `layerVisibility` now has type `{ airports: bool, ports: bool }` (stress is controlled by count, not a toggle). New stress layer added when `data.stressPoints?.length > 0` - valid because the binary columnar object has a top-level `length` property:
```js
new ScatterplotLayer({
  id: 'stress',
  data: data.stressPoints,
  getRadius: 1,
  radiusUnits: 'pixels',
  getFillColor: [0, 180, 255, 60],
  pickable: false,
})
```

No `getPosition` accessor is needed: deck.gl reads position directly from `data.attributes.getPosition` when using binary columnar format. Constant `getRadius` and `getFillColor` values work correctly with binary data. JSDoc updated to reflect new parameters.

**`src/components/LayerPanel.jsx`**

Reads `stressCount` and `setStressCount` from `useMapStore` directly (same pattern as existing store usage).

New section inserted between the existing `layerList.map(...)` block and the `panel-footer`, separated by a `<div className="panel-divider" />`:

```
STRESS TEST
[====slider====]  500K PTS
```

Slider: `<input type="range" min={0} max={1000000} step={50000} />`. Label formats count as `0`, `50K`, `100K` ... `1M` using a helper. Uses existing CSS variables for consistent styling. The `LAYER_COLORS` map does not need a `stress` entry since the stress section is not a checkbox row.

**`src/components/GPUInfoPanel.jsx`**

Destructures `{ tier, adapterInfo, activePointCount, frameTime, frameHistory, gpuThroughput }` from `capabilities`.

Two changes:

1. `FRAME Xms` gains an inline SVG sparkline (120x16px) rendered as a `<svg>` element immediately after the `{frameTime}ms` text, on the same line. Bars scale to local min/max of `frameHistory`. Bars are `var(--text-dim)`, most recent bar is `var(--blue)`. If `frameHistory` is empty or undefined, the `<svg>` element is omitted entirely (not rendered as an empty placeholder).
2. New `COMPUTE` stat appended after `FRAME`: shows the `gpuThroughput` string (e.g., `450 GB/s`) or `--` when unsupported.

**`src/App.jsx`**

Destructures `stressCount` from `useMapStore()` alongside the existing `layerVisibility`, `setLayerVisibility`, `selectedFeature`, and `setSelectedFeature`. Calls `useStressPoints(stressCount)` and adds `stressPoints` to `layerData`:

```js
const { layerVisibility, setLayerVisibility, selectedFeature, setSelectedFeature, stressCount } = useMapStore()
const { stressPoints } = useStressPoints(stressCount)
const layerData = { airports, ports, stressPoints }
```

## Data Flow

```
mapStore.stressCount
  -> App: useStressPoints(stressCount) -> stressPoints
  -> layerData.stressPoints
  -> MapView -> buildLayers -> ScatterplotLayer 'stress'

useGPUCompute() -> gpuThroughput
  -> MapView: capabilities.gpuThroughput
  -> GPUInfoPanel: COMPUTE stat

useFrameTime() -> { frameTime, frameHistory }
  -> MapView: capabilities.frameHistory
  -> GPUInfoPanel: sparkline + FRAME Xms
```

## Error Handling

- `useGPUCompute`: any failure at any stage (adapter request, device creation, shader compilation, dispatch) sets `supported: false` and `throughput: '--'`. No errors surface to the user.
- `useStressPoints`: pure computation, no failure modes.
- Sparkline: if `frameHistory` is empty, renders nothing in place of the SVG.

## Testing

- `useStressPoints`: unit test verifies output shape (`length`, `attributes.getPosition.value` length, `size: 3`), that count 0 returns empty object, and that coordinates are within valid lon/lat ranges.
- `buildLayers`: add tests for stress layer present/absent based on `data.stressPoints`.
- `useGPUCompute`: test with `navigator.gpu` undefined returns `{ supported: false, throughput: '--' }`.
- `GPUInfoPanel`: snapshot or text assertion that `COMPUTE` stat renders; sparkline SVG present when `frameHistory` has data.
- `mapStore`: test `setStressCount` sets value correctly.