# WebGPU Performance Demo Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stress-test point slider (up to 1M synthetic points), a GPU compute bandwidth benchmark using a raw WebGPU compute shader, and a rolling frame-time sparkline — all integrated into the existing map view to demonstrate WebGPU capabilities to technical engineers.

**Architecture:** Three independent data sources flow up through App/MapView into existing display components. `useStressPoints` generates binary columnar point data controlled by `stressCount` in the store. `useGPUCompute` runs a WGSL compute shader every second and reports memory bandwidth. `useFrameTime` is extended to accumulate a rolling 60-frame history. No new components are created.

**Tech Stack:** React, Zustand, deck.gl 9.2.11, WebGPU (navigator.gpu), WGSL, Vitest, React Testing Library

---

## Chunk 1: Data layer — store, useStressPoints, layers, App wiring

### Task 1: Add stressCount to mapStore

**Files:**
- Modify: `src/store/mapStore.js`
- Modify: `src/store/mapStore.test.js`

- [ ] **Step 1.1: Write failing tests**

In `src/store/mapStore.test.js`, add two tests after the existing `setSelectedFeature` test:

```js
it('has default stressCount of 0', () => {
  const { stressCount } = useMapStore.getState()
  expect(stressCount).toBe(0)
})

it('setStressCount updates stressCount', () => {
  const { setStressCount } = useMapStore.getState()
  setStressCount(500000)
  expect(useMapStore.getState().stressCount).toBe(500000)
})
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```
npm test -- --run
```

Expected: 2 failures mentioning `stressCount` not defined.

- [ ] **Step 1.3: Implement stressCount in mapStore**

Replace the contents of `src/store/mapStore.js` with:

```js
import { create } from 'zustand'
import { DEFAULT_VIEW } from '../config/sources.js'

const initialState = {
  viewport: {
    ...DEFAULT_VIEW,
    pitch: 0,
    bearing: 0,
  },
  layerVisibility: {
    airports: true,
    ports: true,
  },
  stressCount: 0,
  selectedFeature: null,
}

export const useMapStore = create((set) => ({
  ...initialState,
  setViewport: (viewport) => set({ viewport }),
  setLayerVisibility: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),
  setStressCount: (count) => set({ stressCount: count }),
  setSelectedFeature: (feature) => set({ selectedFeature: feature }),
}))

useMapStore.getInitialState = () => ({ ...initialState })
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 1.5: Commit**

```
git add src/store/mapStore.js src/store/mapStore.test.js
git commit -m "feat: add stressCount to mapStore"
```

---

### Task 2: useStressPoints hook

**Files:**
- Create: `src/hooks/useStressPoints.js`
- Create: `src/hooks/useStressPoints.test.js`

- [ ] **Step 2.1: Write failing tests**

Create `src/hooks/useStressPoints.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStressPoints } from './useStressPoints.js'

describe('useStressPoints', () => {
  it('returns empty object when count is 0', () => {
    const { result } = renderHook(() => useStressPoints(0))
    expect(result.current.stressPoints).toEqual({})
  })

  it('returns binary columnar object with correct length', () => {
    const { result } = renderHook(() => useStressPoints(100))
    expect(result.current.stressPoints.length).toBe(100)
  })

  it('returns Float32Array with count * 3 values', () => {
    const { result } = renderHook(() => useStressPoints(100))
    const { value, size } = result.current.stressPoints.attributes.getPosition
    expect(value).toBeInstanceOf(Float32Array)
    expect(value.length).toBe(300)
    expect(size).toBe(3)
  })

  it('longitude values are within -180 to 180', () => {
    const { result } = renderHook(() => useStressPoints(500))
    const { value } = result.current.stressPoints.attributes.getPosition
    for (let i = 0; i < value.length; i += 3) {
      expect(value[i]).toBeGreaterThanOrEqual(-180)
      expect(value[i]).toBeLessThanOrEqual(180)
    }
  })

  it('latitude values are within -85 to 85', () => {
    const { result } = renderHook(() => useStressPoints(500))
    const { value } = result.current.stressPoints.attributes.getPosition
    for (let i = 1; i < value.length; i += 3) {
      expect(value[i]).toBeGreaterThanOrEqual(-85)
      expect(value[i]).toBeLessThanOrEqual(85)
    }
  })
})
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```
npm test -- --run
```

Expected: all 5 new tests fail with "Cannot find module".

- [ ] **Step 2.3: Implement useStressPoints**

Create `src/hooks/useStressPoints.js`:

```js
import { useMemo } from 'react'

const EMPTY = {}

export function useStressPoints(count) {
  const stressPoints = useMemo(() => {
    if (!count) return EMPTY
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = Math.random() * 360 - 180  // lon
      positions[i * 3 + 1] = Math.random() * 170 - 85   // lat
      positions[i * 3 + 2] = 0                           // alt
    }
    return {
      length: count,
      attributes: { getPosition: { value: positions, size: 3 } },
    }
  }, [count])

  return { stressPoints }
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 2.5: Commit**

```
git add src/hooks/useStressPoints.js src/hooks/useStressPoints.test.js
git commit -m "feat: add useStressPoints hook"
```

---

### Task 3: Stress layer in buildLayers

**Files:**
- Modify: `src/layers/index.js`
- Modify: `src/layers/index.test.js`

- [ ] **Step 3.1: Write failing tests**

In `src/layers/index.test.js`, add after the existing tests (before the closing `}`):

```js
const mockStressPoints = {
  length: 10,
  attributes: { getPosition: { value: new Float32Array(30), size: 3 } },
}

it('includes stress layer when stressPoints has length > 0', () => {
  const layers = buildLayers(
    { airports: false, ports: false },
    { airports: [], ports: [], stressPoints: mockStressPoints },
    vi.fn()
  )
  expect(layers.map((l) => l.id)).toContain('stress')
})

it('omits stress layer when stressPoints is empty object', () => {
  const layers = buildLayers(
    { airports: false, ports: false },
    { airports: [], ports: [], stressPoints: {} },
    vi.fn()
  )
  expect(layers.map((l) => l.id)).not.toContain('stress')
})

it('omits stress layer when stressPoints is undefined', () => {
  const layers = buildLayers(
    { airports: false, ports: false },
    { airports: [], ports: [] },
    vi.fn()
  )
  expect(layers.map((l) => l.id)).not.toContain('stress')
})

it('stress layer is not pickable', () => {
  const layers = buildLayers(
    { airports: false, ports: false },
    { airports: [], ports: [], stressPoints: mockStressPoints },
    vi.fn()
  )
  const layer = layers.find((l) => l.id === 'stress')
  expect(layer.props.pickable).toBe(false)
})
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```
npm test -- --run
```

Expected: 4 new failures — stress layer not found.

- [ ] **Step 3.3: Add stress layer to buildLayers**

In `src/layers/index.js`, update the JSDoc `@param` for `data` and add the stress block after the ports block, before `return layers`:

Updated JSDoc:
```js
/**
 * Builds the deck.gl layer array from current visibility and data state.
 *
 * @param {Object} layerVisibility - { airports: bool, ports: bool }
 * @param {Object} data - { airports: Array, ports: Array, stressPoints: BinaryColumnarData|{} }
 * @param {Function} onFeatureClick - called with { properties: object } on click
 */
```

Add after the ports block:
```js
  if (data.stressPoints?.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'stress',
        data: data.stressPoints,
        getRadius: 1,
        radiusUnits: 'pixels',
        getFillColor: [0, 180, 255, 60],
        pickable: false,
      })
    )
  }
```

Note: no `getPosition` accessor is needed — deck.gl reads position from `data.attributes.getPosition` automatically when using binary columnar format. Constant `getRadius` and `getFillColor` arrays work correctly with binary data.

- [ ] **Step 3.4: Run tests to confirm they pass**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 3.5: Commit**

```
git add src/layers/index.js src/layers/index.test.js
git commit -m "feat: add stress points layer to buildLayers"
```

---

### Task 4: Wire stressCount and stressPoints in App.jsx

**Files:**
- Modify: `src/App.jsx`

No separate unit tests — the data flow is validated by the hook and layer tests above.

- [ ] **Step 4.1: Update App.jsx**

Replace the contents of `src/App.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useAirports } from './hooks/useAirports.js'
import { usePorts } from './hooks/usePorts.js'
import { useStressPoints } from './hooks/useStressPoints.js'

function Header() {
  const viewport = useMapStore((s) => s.viewport)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const utc = time.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
  const lat = Math.abs(viewport.latitude).toFixed(4) + (viewport.latitude >= 0 ? '°N' : '°S')
  const lon = Math.abs(viewport.longitude).toFixed(4) + (viewport.longitude >= 0 ? '°E' : '°W')

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="classification-badge">UNCLASSIFIED</span>
        <span className="header-sep">◆</span>
        <span className="header-status">
          SYS&nbsp;<span className="ok">NOMINAL</span>
        </span>
      </div>

      <div className="header-center">
        <span className="app-title">WebGPU Groundtruth</span>
      </div>

      <div className="header-right">
        <span className="coord-display">{lat}&nbsp;&nbsp;{lon}</span>
        <span className="header-sep">◆</span>
        <span className="time-display">{utc}</span>
      </div>
    </header>
  )
}

export default function App() {
  const {
    layerVisibility,
    setLayerVisibility,
    selectedFeature,
    setSelectedFeature,
    stressCount,
  } = useMapStore()

  const { airports } = useAirports()
  const { ports } = usePorts()
  const { stressPoints } = useStressPoints(stressCount)

  const layerData = {
    airports,
    ports,
    stressPoints,
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <MapView layerData={layerData} />
        <LayerPanel visibility={layerVisibility} onToggle={setLayerVisibility} />
        <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4.2: Run full test suite to confirm nothing broken**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 4.3: Commit**

```
git add src/App.jsx
git commit -m "feat: wire stressCount and stressPoints in App"
```

---

## Chunk 2: UI — LayerPanel stress slider

### Task 5: Stress test slider in LayerPanel

**Files:**
- Modify: `src/components/LayerPanel.jsx`
- Modify: `src/components/LayerPanel.test.jsx`
- Modify: `src/index.css`

- [ ] **Step 5.1: Write failing tests**

Replace the contents of `src/components/LayerPanel.test.jsx` with:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerPanel } from './LayerPanel.jsx'
import { LAYERS } from '../config/sources.js'
import { useMapStore } from '../store/mapStore.js'

const visibility = { airports: true, ports: true }

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
})

describe('LayerPanel', () => {
  it('renders a toggle for each layer', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    Object.values(LAYERS).forEach(({ label }) => {
      expect(screen.getByText(label.toUpperCase())).toBeInTheDocument()
    })
  })

  it('reflects current visibility state', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const firstCheckbox = screen.getAllByRole('checkbox')[0]
    expect(firstCheckbox.checked).toBe(true)
  })

  it('calls onToggle with layer id and new value', () => {
    const onToggle = vi.fn()
    render(<LayerPanel visibility={visibility} onToggle={onToggle} />)
    const firstCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(firstCheckbox)
    expect(onToggle).toHaveBeenCalledWith('airports', false)
  })
})

describe('LayerPanel stress slider', () => {
  it('renders STRESS TEST label', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('STRESS TEST')).toBeInTheDocument()
  })

  it('renders a range slider with correct attributes', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '1000000')
    expect(slider).toHaveAttribute('step', '50000')
  })

  it('displays 0 PTS when stressCount is 0', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('0 PTS')).toBeInTheDocument()
  })

  it('displays formatted count when stressCount is 500000', () => {
    useMapStore.setState({ stressCount: 500000 })
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('500K PTS')).toBeInTheDocument()
  })

  it('calls setStressCount when slider changes', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '500000' } })
    expect(useMapStore.getState().stressCount).toBe(500000)
  })
})
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```
npm test -- --run
```

Expected: the 5 new stress slider tests fail — "STRESS TEST" not found, no slider rendered.

- [ ] **Step 5.3: Update LayerPanel.jsx**

Replace the contents of `src/components/LayerPanel.jsx` with:

```jsx
import { LAYERS } from '../config/sources.js'
import { useMapStore } from '../store/mapStore.js'

const LAYER_COLORS = {
  airports: 'var(--amber)',
  ports:    'var(--green)',
}

function formatCount(n) {
  if (n === 0) return '0 PTS'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M PTS`
  return `${(n / 1_000).toFixed(0)}K PTS`
}

export function LayerPanel({ visibility, onToggle }) {
  const { stressCount, setStressCount } = useMapStore()

  const layerList = Object.values(LAYERS)
  const activeCount = layerList.filter(({ id }) => visibility[id] ?? true).length
  const totalCount = layerList.length

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        <span className="panel-title">SENSOR LAYERS</span>
        <span className="panel-indicator" />
      </div>

      {layerList.map(({ id, label }) => {
        const active = visibility[id] ?? true
        return (
          <label key={id} className={`layer-row${active ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => onToggle(id, e.target.checked)}
            />
            <span
              className="layer-dot"
              style={{ background: active ? LAYER_COLORS[id] : 'var(--text-dim)' }}
            />
            <span className="layer-label">{label.toUpperCase()}</span>
            <span className={`layer-toggle ${active ? 'on' : 'off'}`}>
              {active ? 'ON' : 'OFF'}
            </span>
          </label>
        )
      })}

      <div className="panel-divider" />

      <div className="stress-section">
        <span className="panel-title">STRESS TEST</span>
        <div className="stress-row">
          <input
            type="range"
            min={0}
            max={1000000}
            step={50000}
            value={stressCount}
            onChange={(e) => setStressCount(Number(e.target.value))}
            className="stress-slider"
          />
          <span className="stress-count">{formatCount(stressCount)}</span>
        </div>
      </div>

      <div className="panel-footer">
        <span className="footer-stat">
          ACTIVE&nbsp;{activeCount}/{totalCount}
        </span>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5.4: Add CSS for stress section**

In `src/index.css`, add after the `.panel-footer` block (after line 338):

```css
/* ─── STRESS TEST SLIDER ─── */

.panel-divider {
  height: 1px;
  background: var(--border);
  margin: 0;
}

.stress-section {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.stress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.stress-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 2px;
  background: var(--text-dim);
  outline: none;
  cursor: pointer;
}

.stress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  background: var(--blue);
  cursor: pointer;
  box-shadow: 0 0 6px var(--blue);
}

.stress-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  background: var(--blue);
  border: none;
  cursor: pointer;
  box-shadow: 0 0 6px var(--blue);
}

.stress-count {
  font-size: 10px;
  letter-spacing: 0.10em;
  color: var(--blue);
  white-space: nowrap;
  min-width: 56px;
  text-align: right;
}
```

- [ ] **Step 5.5: Run tests to confirm they pass**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 5.6: Commit**

```
git add src/components/LayerPanel.jsx src/components/LayerPanel.test.jsx src/index.css
git commit -m "feat: add stress test slider to LayerPanel"
```

---

## Chunk 3: Compute + display — useGPUCompute, MapView, GPUInfoPanel

### Task 6: useGPUCompute hook

**Files:**
- Create: `src/hooks/useGPUCompute.js`
- Create: `src/hooks/useGPUCompute.test.js`

- [ ] **Step 6.1: Write failing test**

Create `src/hooks/useGPUCompute.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGPUCompute } from './useGPUCompute.js'

describe('useGPUCompute', () => {
  it('returns supported: false and throughput: "--" when navigator.gpu is undefined', () => {
    // jsdom does not implement navigator.gpu, so this tests the fallback path
    const { result } = renderHook(() => useGPUCompute())
    expect(result.current.supported).toBe(false)
    expect(result.current.throughput).toBe('--')
  })
})
```

- [ ] **Step 6.2: Run test to confirm it fails**

```
npm test -- --run
```

Expected: 1 failure — "Cannot find module".

- [ ] **Step 6.3: Implement useGPUCompute**

Create `src/hooks/useGPUCompute.js`:

```js
import { useState, useEffect } from 'react'

const COUNT = 16 * 1024 * 1024  // 16M floats = 64MB
const WORKGROUP_SIZE = 256
const WORKGROUPS = COUNT / WORKGROUP_SIZE  // 65536

const SHADER = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < arrayLength(&data)) {
    data[i] = data[i] * 1.0000001;
  }
}
`

export function useGPUCompute() {
  const [state, setState] = useState({ throughput: '--', supported: false })

  useEffect(() => {
    if (!navigator.gpu) return

    let intervalId = null
    let device = null
    let buf = null

    async function init() {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) return

        device = await adapter.requestDevice()

        buf = device.createBuffer({
          size: COUNT * 4,
          usage: GPUBufferUsage.STORAGE,
          mappedAtCreation: true,
        })
        new Float32Array(buf.getMappedRange()).fill(1.0)
        buf.unmap()

        const module = device.createShaderModule({ code: SHADER })
        const pipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint: 'main' },
        })
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: buf } }],
        })

        setState({ throughput: '...', supported: true })

        intervalId = setInterval(async () => {
          try {
            const t0 = performance.now()
            const encoder = device.createCommandEncoder()
            const pass = encoder.beginComputePass()
            pass.setPipeline(pipeline)
            pass.setBindGroup(0, bindGroup)
            pass.dispatchWorkgroups(WORKGROUPS)
            pass.end()
            device.queue.submit([encoder.finish()])
            await device.queue.onSubmittedWorkDone()
            const elapsed = (performance.now() - t0) / 1000
            // 128MB traffic per dispatch: 64MB read + 64MB write
            const gbps = (0.128 / elapsed).toFixed(1)
            setState({ throughput: `${gbps} GB/s`, supported: true })
          } catch {
            setState({ throughput: '--', supported: false })
          }
        }, 1000)
      } catch {
        setState({ throughput: '--', supported: false })
      }
    }

    init()

    return () => {
      if (intervalId) clearInterval(intervalId)
      buf?.destroy()
      device?.destroy()
    }
  }, [])

  return state
}
```

- [ ] **Step 6.4: Run test to confirm it passes**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 6.5: Commit**

```
git add src/hooks/useGPUCompute.js src/hooks/useGPUCompute.test.js
git commit -m "feat: add useGPUCompute hook with WGSL bandwidth benchmark"
```

---

### Task 7: Extend useFrameTime and integrate compute in MapView

**Files:**
- Modify: `src/components/MapView.jsx`

No unit tests for MapView itself — the hook behavior is tested through GPUInfoPanel rendering in Task 8.

- [ ] **Step 7.1: Update MapView.jsx**

Replace the contents of `src/components/MapView.jsx` with:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildLayers } from '../layers/index.js'
import { useMapStore } from '../store/mapStore.js'
import { BASEMAP_STYLE } from '../config/sources.js'
import { useGPUCapabilities } from '../hooks/useGPUCapabilities.js'
import { useGPUCompute } from '../hooks/useGPUCompute.js'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

function DeckGLOverlay({ layers }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false, useDevicePixels: false }))
  overlay.setProps({ layers })
  return null
}

function useFrameTime() {
  const [frameTime, setFrameTime] = useState(0)
  const [frameHistory, setFrameHistory] = useState([])
  // eslint-disable-next-line react-hooks/purity
  const lastRef = useRef(performance.now())

  useEffect(() => {
    let rafId
    function tick(now) {
      const dt = Math.round(now - lastRef.current)
      lastRef.current = now
      setFrameTime(dt)
      setFrameHistory((h) => {
        const next = [...h, dt]
        return next.length > 60 ? next.slice(next.length - 60) : next
      })
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return { frameTime, frameHistory }
}

export function MapView({ layerData }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()
  const gpuBase = useGPUCapabilities()
  const { frameTime, frameHistory } = useFrameTime()
  const { throughput: gpuThroughput } = useGPUCompute()

  const activePointCount =
    (layerVisibility.airports ? (layerData.airports?.length ?? 0) : 0) +
    (layerVisibility.ports    ? (layerData.ports?.length ?? 0)    : 0) +
    (layerData.stressPoints?.length ?? 0)

  const capabilities = useMemo(
    () => ({ ...gpuBase, activePointCount, frameTime, frameHistory, gpuThroughput }),
    [gpuBase, activePointCount, frameTime, frameHistory, gpuThroughput]
  )

  const onFeatureClick = useCallback(
    (feature) => setSelectedFeature(feature),
    [setSelectedFeature]
  )

  const layers = useMemo(
    () => buildLayers(layerVisibility, layerData, onFeatureClick),
    [layerVisibility, layerData, onFeatureClick]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        {...viewport}
        style={{ width: '100%', height: '100%' }}
        mapStyle={BASEMAP_STYLE}
        onMove={(evt) => setViewport(evt.viewState)}
      >
        <DeckGLOverlay layers={layers} />
      </Map>
      <div className="map-vignette" />
      <GPUInfoPanel capabilities={capabilities} />
    </div>
  )
}
```

- [ ] **Step 7.2: Run tests to confirm nothing broken**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 7.3: Commit**

```
git add src/components/MapView.jsx
git commit -m "feat: extend useFrameTime with history, integrate useGPUCompute in MapView"
```

---

### Task 8: Update GPUInfoPanel with sparkline and compute stat

**Files:**
- Modify: `src/components/GPUInfoPanel.jsx`
- Create: `src/components/GPUInfoPanel.test.jsx`

- [ ] **Step 8.1: Write failing tests**

Create `src/components/GPUInfoPanel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

const base = {
  tier: 'webgpu',
  adapterInfo: { device: 'Test GPU' },
  activePointCount: 1000,
  frameTime: 16,
  frameHistory: [],
  gpuThroughput: '--',
}

describe('GPUInfoPanel', () => {
  it('renders GPU device name', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('Test GPU')).toBeInTheDocument()
  })

  it('renders COMPUTE key', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('COMPUTE')).toBeInTheDocument()
  })

  it('renders compute throughput value', () => {
    render(<GPUInfoPanel capabilities={{ ...base, gpuThroughput: '450 GB/s' }} />)
    expect(screen.getByText('450 GB/s')).toBeInTheDocument()
  })

  it('renders -- when compute unsupported', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders sparkline SVG when frameHistory has data', () => {
    const { container } = render(
      <GPUInfoPanel capabilities={{ ...base, frameHistory: [16, 17, 15, 18, 16] }} />
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('omits sparkline SVG when frameHistory is empty', () => {
    const { container } = render(<GPUInfoPanel capabilities={base} />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 8.2: Run tests to confirm they fail**

```
npm test -- --run
```

Expected: "COMPUTE" not found, SVG assertions fail.

- [ ] **Step 8.3: Update GPUInfoPanel.jsx**

Replace the contents of `src/components/GPUInfoPanel.jsx` with:

```jsx
function Sparkline({ history }) {
  if (!history || history.length === 0) return null

  const max = Math.max(...history)
  const min = Math.min(...history)
  const range = max - min || 1
  const BAR_W = 2
  const HEIGHT = 16

  return (
    <svg
      width={history.length * BAR_W}
      height={HEIGHT}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '6px' }}
    >
      {history.map((t, i) => {
        const h = Math.max(2, Math.round(((t - min) / range) * 12) + 2)
        return (
          <rect
            key={i}
            x={i * BAR_W}
            y={HEIGHT - h}
            width={BAR_W - 0.5}
            height={h}
            fill={i === history.length - 1 ? 'var(--blue)' : 'var(--text-dim)'}
          />
        )
      })}
    </svg>
  )
}

export function GPUInfoPanel({ capabilities }) {
  const { tier, adapterInfo, activePointCount, frameTime, frameHistory, gpuThroughput } = capabilities

  const deviceLabel =
    adapterInfo.device || adapterInfo.description || adapterInfo.vendor || adapterInfo.architecture || 'Unknown'
  const renderLabel =
    tier === 'no-webgpu' ? 'WebGL Fallback' : tier === 'unknown' ? 'Detecting...' : 'WebGPU'
  const isWebGPU = tier === 'webgpu'

  return (
    <div className="gpu-info-panel">
      <span className="gpu-info-item">
        <span className="gpu-info-key">GPU</span>
        <span className="gpu-info-val">{deviceLabel}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">RENDER</span>
        <span className={`gpu-info-val ${isWebGPU ? 'ok' : 'warn'}`}>{renderLabel}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">PTS</span>
        <span className="gpu-info-val">{activePointCount.toLocaleString()}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">FRAME</span>
        <span className="gpu-info-val">
          {frameTime}ms
          <Sparkline history={frameHistory} />
        </span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">COMPUTE</span>
        <span className="gpu-info-val">{gpuThroughput}</span>
      </span>
    </div>
  )
}
```

- [ ] **Step 8.4: Run tests to confirm they pass**

```
npm test -- --run
```

Expected: all pass.

- [ ] **Step 8.5: Commit**

```
git add src/components/GPUInfoPanel.jsx src/components/GPUInfoPanel.test.jsx
git commit -m "feat: add sparkline and compute stat to GPUInfoPanel"
```

---

### Task 9: Final verification

- [ ] **Step 9.1: Run full test suite**

```
npm test -- --run
```

Expected: all tests pass across all files.

- [ ] **Step 9.2: Start dev server and manually verify**

```
npm run dev
```

Check:
- LayerPanel shows STRESS TEST slider below layer toggles
- Dragging slider to 500K adds ~500,000 cyan dots on the map
- GPUInfoPanel FRAME stat shows a sparkline building up after a few seconds
- GPUInfoPanel COMPUTE stat shows `-- ` (no WebGPU in most dev environments unless running Chrome with WebGPU enabled) or a GB/s reading if WebGPU is available
- PTS count in GPUInfoPanel updates as slider moves
- Airports and ports layers still toggle correctly