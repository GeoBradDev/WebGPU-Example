# Satellite Constellation Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time satellite constellation layer to the WebGPU Groundtruth app, rendering all ~23,000+ tracked orbital objects with a WebGPU compute classifier and live point-count metrics.

**Architecture:** A Web Worker propagates satellite TLE data using satellite.js every 10 seconds, posting typed arrays of positions and active-flags to the main thread. A WebGPU compute shader classifies each point (active vs debris) and writes per-point RGBA colors; a CPU fallback does the same when WebGPU is unavailable. The resulting binary arrays are fed directly to a deck.gl ScatterplotLayer as columnar binary attributes.

**Tech Stack:** React + Vite, deck.gl (WebGPU backend via luma.gl), satellite.js, WGSL compute shaders, Zustand, Vitest

---

## Chunk 1: Foundation

### Task 1: Install satellite.js and configure Vite proxy

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `vite.config.js`

- [ ] **Step 1: Install satellite.js**

Run: `npm install satellite.js`
Expected: satellite.js appears in `dependencies` in `package.json`

- [ ] **Step 2: Add Celestrak proxy to vite.config.js**

Celestrak does not send CORS headers that browsers accept for cross-origin fetches. The Vite dev server proxy handles this transparently. Open `vite.config.js` and add a `server.proxy` block:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['deck.gl', '@deck.gl/react', '@deck.gl/mapbox', '@deck.gl/layers', '@luma.gl/webgpu'],
    include: ['earcut'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})
```

- [ ] **Step 3: Verify dev server starts without errors**

Run: `npm run dev`
Expected: Server starts, no proxy errors in terminal. Stop with Ctrl+C.

---

### Task 2: Update config/sources.js

**Files:**
- Modify: `src/config/sources.js`

- [ ] **Step 1: Add Celestrak URLs and satellite layer config**

Open `src/config/sources.js` and add to the bottom (before `DEFAULT_VIEW`):

```js
// Celestrak TLE feeds — proxied through Vite dev server to avoid CORS
export const CELESTRAK_CATALOG_URL = '/celestrak/pub/TLE/catalog.txt'
export const CELESTRAK_ACTIVE_URL = '/celestrak/pub/TLE/active.txt'
// Cache TLE data in sessionStorage for up to 1 hour (ms)
export const CELESTRAK_CACHE_TTL = 60 * 60 * 1000
// Re-propagate satellite positions every N ms
export const SATELLITE_PROPAGATE_INTERVAL = 10_000
```

Also add the satellite layer entry to `LAYERS`:

```js
export const LAYERS = {
  AIS: {
    id: 'points',
    label: 'AIS Vessels',
  },
  ADSB: {
    id: 'adsb',
    label: 'ADS-B Aircraft',
  },
  SATELLITES: {
    id: 'satellites',
    label: 'Satellites',
  },
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npm run lint`
Expected: No errors.

---

### Task 3: Update mapStore.js and its tests

**Files:**
- Modify: `src/store/mapStore.js`
- Modify: `src/store/mapStore.test.js`

- [ ] **Step 1: Write failing tests for new store fields**

Open `src/store/mapStore.test.js` and add after the existing tests:

```js
  it('satellites layer is visible by default', () => {
    const { layerVisibility } = useMapStore.getState()
    expect(layerVisibility.satellites).toBe(true)
  })

  it('satelliteFilter defaults to all', () => {
    const { satelliteFilter } = useMapStore.getState()
    expect(satelliteFilter).toBe('all')
  })

  it('setSatelliteFilter updates to active', () => {
    const { setSatelliteFilter } = useMapStore.getState()
    setSatelliteFilter('active')
    expect(useMapStore.getState().satelliteFilter).toBe('active')
  })

  it('setSatelliteFilter updates back to all', () => {
    const { setSatelliteFilter } = useMapStore.getState()
    setSatelliteFilter('active')
    setSatelliteFilter('all')
    expect(useMapStore.getState().satelliteFilter).toBe('all')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- mapStore`
Expected: The 4 new tests FAIL (satelliteFilter is undefined, setSatelliteFilter is not a function)

- [ ] **Step 3: Update mapStore.js**

Open `src/store/mapStore.js` and update `initialState` and the store:

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
    points: true,
    adsb: true,
    satellites: true,
  },
  selectedFeature: null,
  satelliteFilter: 'all',
}

export const useMapStore = create((set) => ({
  ...initialState,
  setViewport: (viewport) => set({ viewport }),
  setLayerVisibility: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),
  setSelectedFeature: (feature) => set({ selectedFeature: feature }),
  setSatelliteFilter: (filter) => set({ satelliteFilter: filter }),
}))

useMapStore.getInitialState = () => ({ ...initialState })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- mapStore`
Expected: All tests PASS including the 4 new ones.

---

## Chunk 2: Data and GPU Pipeline

### Task 4: Celestrak API module

**Files:**
- Create: `src/api/celestrak.js`
- Create: `src/api/celestrak.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/api/celestrak.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseTLEText, getCacheKey } from './celestrak.js'

describe('parseTLEText', () => {
  const sampleTLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00001234  00000-0  12345-4 0  9999
2 25544  51.6416 123.4567 0001234  90.1234 270.0000 15.49999999123456
STARLINK-1000
1 44235U 19029AC  24001.50000000  .00000123  00000-0  12345-5 0  9999
2 44235  53.0000 200.0000 0001000 100.0000 260.0000 15.06399999123456`

  it('returns an array of parsed TLE objects', () => {
    const result = parseTLEText(sampleTLE, true)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
  })

  it('each object has name, line1, line2', () => {
    const result = parseTLEText(sampleTLE, true)
    expect(result[0].name).toBe('ISS (ZARYA)')
    expect(result[0].line1).toMatch(/^1 /)
    expect(result[0].line2).toMatch(/^2 /)
  })

  it('isActive flag is set correctly', () => {
    const result = parseTLEText(sampleTLE, true)
    expect(result[0].isActive).toBe(true)
    const debrisResult = parseTLEText(sampleTLE, false)
    expect(debrisResult[0].isActive).toBe(false)
  })

  it('handles empty input gracefully', () => {
    const result = parseTLEText('', true)
    expect(result).toEqual([])
  })

  it('skips incomplete entries', () => {
    const partial = `INCOMPLETE
1 25544U 98067A   24001.50000000  .00001234  00000-0  12345-4 0  9999`
    const result = parseTLEText(partial, true)
    expect(result.length).toBe(0)
  })
})

describe('getCacheKey', () => {
  it('returns a string', () => {
    expect(typeof getCacheKey('catalog')).toBe('string')
  })

  it('differs by feed name', () => {
    expect(getCacheKey('catalog')).not.toBe(getCacheKey('active'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- celestrak`
Expected: FAIL — module not found

- [ ] **Step 3: Create src/api/celestrak.js**

```js
import {
  CELESTRAK_CATALOG_URL,
  CELESTRAK_ACTIVE_URL,
  CELESTRAK_CACHE_TTL,
} from '../config/sources.js'

/**
 * Parses a 3-line TLE text block into an array of { name, line1, line2, isActive }.
 * Lines that start with '1 ' or '2 ' are TLE lines; everything else is a name.
 * Incomplete triplets are silently dropped.
 * @param {string} text - raw TLE text from Celestrak
 * @param {boolean} isActive - flag to tag all entries from this feed
 * @returns {{ name: string, line1: string, line2: string, isActive: boolean }[]}
 */
export function parseTLEText(text, isActive) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const entries = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      // 2-line format (no name line)
      entries.push({ name: 'UNKNOWN', line1: line, line2: lines[i + 1], isActive })
      i += 2
    } else if (
      !line.startsWith('1 ') &&
      !line.startsWith('2 ') &&
      i + 2 < lines.length &&
      lines[i + 1].startsWith('1 ') &&
      lines[i + 2].startsWith('2 ')
    ) {
      // 3-line format
      entries.push({ name: line, line1: lines[i + 1], line2: lines[i + 2], isActive })
      i += 3
    } else {
      i++
    }
  }
  return entries
}

/**
 * Returns a sessionStorage cache key for the given feed name.
 */
export function getCacheKey(feed) {
  return `celestrak_tle_${feed}`
}

function readCache(feed) {
  try {
    const raw = sessionStorage.getItem(getCacheKey(feed))
    if (!raw) return null
    const { text, ts } = JSON.parse(raw)
    if (Date.now() - ts > CELESTRAK_CACHE_TTL) return null
    return text
  } catch {
    return null
  }
}

function writeCache(feed, text) {
  try {
    sessionStorage.setItem(getCacheKey(feed), JSON.stringify({ text, ts: Date.now() }))
  } catch {
    // sessionStorage quota exceeded — ignore
  }
}

async function fetchWithRetry(url, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (i === attempts - 1) throw err
    }
  }
}

/**
 * Fetches both Celestrak TLE feeds, merges them, and returns a unified array.
 * Uses sessionStorage cache to avoid redundant fetches within CELESTRAK_CACHE_TTL.
 * Falls back to cached data on fetch failure.
 * @returns {Promise<{ name: string, line1: string, line2: string, isActive: boolean }[]>}
 */
export async function fetchTLEData() {
  let catalogText = readCache('catalog')
  let activeText = readCache('active')

  const errors = []

  if (!catalogText) {
    try {
      catalogText = await fetchWithRetry(CELESTRAK_CATALOG_URL)
      writeCache('catalog', catalogText)
    } catch (err) {
      errors.push(err)
      catalogText = ''
    }
  }

  if (!activeText) {
    try {
      activeText = await fetchWithRetry(CELESTRAK_ACTIVE_URL)
      writeCache('active', activeText)
    } catch (err) {
      errors.push(err)
      activeText = ''
    }
  }

  if (!catalogText && !activeText) {
    throw new Error(`Failed to fetch TLE data: ${errors.map((e) => e.message).join(', ')}`)
  }

  // Build a set of names from the active feed for deduplication
  const activeEntries = parseTLEText(activeText, true)
  const activeNames = new Set(activeEntries.map((e) => e.name))

  // Parse full catalog, marking objects active if they appear in the active feed
  const catalogEntries = parseTLEText(catalogText, false).map((e) => ({
    ...e,
    isActive: activeNames.has(e.name),
  }))

  // Merge: catalog is the superset; active feed adds no new entries beyond catalog
  return catalogEntries.length > 0 ? catalogEntries : activeEntries
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- celestrak`
Expected: All tests PASS

---

### Task 5: Satellite Web Worker

**Files:**
- Create: `src/workers/satellite.worker.js`

No unit tests for the worker itself (workers run in a separate context). The worker's propagation logic is validated indirectly through the useSatellites hook tests in Task 7.

- [ ] **Step 1: Create the worker**

Create `src/workers/satellite.worker.js`:

```js
import * as satellite from 'satellite.js'
import { SATELLITE_PROPAGATE_INTERVAL } from '../config/sources.js'

let tleEntries = []
let intervalId = null

/**
 * Propagates all TLE entries to the current time using SGP4.
 * Returns two transferable TypedArrays:
 *   positionsF32 — Float32Array [lon0, lat0, lon1, lat1, ...]  (degrees)
 *   activeFlagsU32 — Uint32Array [isActive0, isActive1, ...]   (0 or 1)
 * Entries that fail propagation are skipped (position set to [0,0], flag 0).
 */
function propagateAll() {
  const n = tleEntries.length
  const positionsF32 = new Float32Array(n * 2)
  const activeFlagsU32 = new Uint32Array(n)
  const now = new Date()
  const gmst = satellite.gstime(now)

  for (let i = 0; i < n; i++) {
    const { satrec, isActive } = tleEntries[i]
    try {
      const posVel = satellite.propagate(satrec, now)
      if (!posVel.position || posVel.position === false) continue
      const geo = satellite.eciToGeodetic(posVel.position, gmst)
      positionsF32[i * 2] = satellite.degreesLong(geo.longitude)
      positionsF32[i * 2 + 1] = satellite.degreesLat(geo.latitude)
      activeFlagsU32[i] = isActive ? 1 : 0
    } catch {
      // Failed propagation: leave as 0,0 with flag 0
    }
  }

  return { positionsF32, activeFlagsU32 }
}

function propagateAndPost() {
  const { positionsF32, activeFlagsU32 } = propagateAll()
  self.postMessage(
    { type: 'positions', positionsF32, activeFlagsU32, count: tleEntries.length },
    [positionsF32.buffer, activeFlagsU32.buffer]
  )
}

self.onmessage = (evt) => {
  const { type, entries } = evt.data

  if (type === 'init') {
    tleEntries = entries.map(({ line1, line2, isActive }) => ({
      satrec: satellite.twoline2satrec(line1, line2),
      isActive,
    }))

    // Propagate immediately, then on interval
    propagateAndPost()
    if (intervalId) clearInterval(intervalId)
    intervalId = setInterval(propagateAndPost, SATELLITE_PROPAGATE_INTERVAL)
  }

  if (type === 'stop') {
    if (intervalId) clearInterval(intervalId)
  }
}
```

- [ ] **Step 2: Verify no lint errors**

Run: `npm run lint`
Expected: No errors.

---

### Task 6: GPU Classifier

**Files:**
- Create: `src/gpu/classifier.js`
- Create: `src/gpu/classifier.test.js`

- [ ] **Step 1: Write failing tests (CPU fallback path)**

Create `src/gpu/classifier.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { classifyCPU } from './classifier.js'

describe('classifyCPU', () => {
  it('returns colorsU8 array of 4 bytes per point', () => {
    const flags = new Uint32Array([1, 0, 1])
    const { colorsU8 } = classifyCPU(flags, 'all')
    expect(colorsU8).toBeInstanceOf(Uint8Array)
    expect(colorsU8.length).toBe(12)
  })

  it('active point gets non-transparent color in all mode', () => {
    const flags = new Uint32Array([1])
    const { colorsU8 } = classifyCPU(flags, 'all')
    // alpha (index 3) should be > 0
    expect(colorsU8[3]).toBeGreaterThan(0)
  })

  it('debris point gets non-transparent color in all mode', () => {
    const flags = new Uint32Array([0])
    const { colorsU8 } = classifyCPU(flags, 'all')
    expect(colorsU8[3]).toBeGreaterThan(0)
  })

  it('debris point is transparent in active mode', () => {
    const flags = new Uint32Array([0])
    const { colorsU8 } = classifyCPU(flags, 'active')
    expect(colorsU8[3]).toBe(0)
  })

  it('active point is visible in active mode', () => {
    const flags = new Uint32Array([1])
    const { colorsU8 } = classifyCPU(flags, 'active')
    expect(colorsU8[3]).toBeGreaterThan(0)
  })

  it('visibleCount counts only non-transparent points in all mode', () => {
    const flags = new Uint32Array([1, 0, 1, 0])
    const { visibleCount } = classifyCPU(flags, 'all')
    expect(visibleCount).toBe(4)
  })

  it('visibleCount counts only active points in active mode', () => {
    const flags = new Uint32Array([1, 0, 1, 0])
    const { visibleCount } = classifyCPU(flags, 'active')
    expect(visibleCount).toBe(2)
  })

  it('handles empty flags array', () => {
    const flags = new Uint32Array([])
    const { colorsU8, visibleCount } = classifyCPU(flags, 'all')
    expect(colorsU8.length).toBe(0)
    expect(visibleCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- classifier`
Expected: FAIL — module not found

- [ ] **Step 3: Create src/gpu/classifier.js**

```js
// Color constants (RGBA, 0-255)
const COLOR_ACTIVE = [0, 255, 140, 217]     // green-cyan, mostly opaque
const COLOR_DEBRIS = [255, 128, 0, 128]      // orange, semi-transparent
const COLOR_HIDDEN = [0, 0, 0, 0]            // fully transparent

/**
 * CPU fallback: classifies each point by active flag and filter mode,
 * writes RGBA colors into a Uint8Array.
 * @param {Uint32Array} activeFlagsU32 - 1 = active satellite, 0 = debris/unknown
 * @param {'all'|'active'} filterMode
 * @returns {{ colorsU8: Uint8Array, visibleCount: number }}
 */
export function classifyCPU(activeFlagsU32, filterMode) {
  const n = activeFlagsU32.length
  const colorsU8 = new Uint8Array(n * 4)
  let visibleCount = 0

  for (let i = 0; i < n; i++) {
    const isActive = activeFlagsU32[i] === 1
    const visible = filterMode === 'all' || isActive
    const color = visible ? (isActive ? COLOR_ACTIVE : COLOR_DEBRIS) : COLOR_HIDDEN
    colorsU8[i * 4] = color[0]
    colorsU8[i * 4 + 1] = color[1]
    colorsU8[i * 4 + 2] = color[2]
    colorsU8[i * 4 + 3] = color[3]
    if (visible) visibleCount++
  }

  return { colorsU8, visibleCount }
}

const WGSL_SHADER = `
@group(0) @binding(0) var<storage, read> flags: array<u32>;
@group(0) @binding(1) var<storage, read_write> colors: array<u32>;
@group(0) @binding(2) var<storage, read_write> visible_count: atomic<u32>;
@group(0) @binding(3) var<uniform> filter_mode: u32;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&flags)) { return; }

  let is_active = flags[i] == 1u;
  let visible = filter_mode == 0u || is_active;

  if (visible) {
    atomicAdd(&visible_count, 1u);
    if (is_active) {
      colors[i] = 0u | (255u << 8u) | (140u << 16u) | (217u << 24u);
    } else {
      colors[i] = 255u | (128u << 8u) | (0u << 16u) | (128u << 24u);
    }
  } else {
    colors[i] = 0u;
  }
}
`

/**
 * Manages a WebGPU compute pipeline for satellite classification.
 * Call init() once to set up the device and pipeline.
 * Call classify() each time flags or filter mode changes.
 * Falls back to classifyCPU if WebGPU is unavailable.
 */
export class GPUClassifier {
  constructor() {
    this._device = null
    this._pipeline = null
    this._ready = false
    this._fallback = false
  }

  async init() {
    if (!navigator.gpu) {
      this._fallback = true
      return
    }
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) { this._fallback = true; return }
      this._device = await adapter.requestDevice()
      const module = this._device.createShaderModule({ code: WGSL_SHADER })
      this._pipeline = this._device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      })
      this._ready = true
    } catch {
      this._fallback = true
    }
  }

  get usingFallback() {
    return this._fallback
  }

  /**
   * Classifies satellite points using WebGPU compute or CPU fallback.
   * @param {Uint32Array} activeFlagsU32
   * @param {'all'|'active'} filterMode
   * @returns {Promise<{ colorsU8: Uint8Array, visibleCount: number }>}
   */
  async classify(activeFlagsU32, filterMode) {
    if (this._fallback || !this._ready) {
      return classifyCPU(activeFlagsU32, filterMode)
    }

    const device = this._device
    const n = activeFlagsU32.length
    const filterModeU32 = filterMode === 'active' ? 1 : 0

    // Upload flags buffer
    const flagsBuffer = device.createBuffer({
      size: activeFlagsU32.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(flagsBuffer, 0, activeFlagsU32)

    // Colors output buffer (u32 per point, interpreted as RGBA bytes)
    const colorsBuffer = device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })

    // Visible count buffer (atomic u32, initialized to 0)
    const countBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(countBuffer, 0, new Uint32Array([0]))

    // Filter mode uniform buffer
    const uniformBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(uniformBuffer, 0, new Uint32Array([filterModeU32]))

    const bindGroup = device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: flagsBuffer } },
        { binding: 1, resource: { buffer: colorsBuffer } },
        { binding: 2, resource: { buffer: countBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    })

    const commandEncoder = device.createCommandEncoder()
    const pass = commandEncoder.beginComputePass()
    pass.setPipeline(this._pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(n / 64))
    pass.end()

    // Staging buffers for readback
    const colorsStagingBuffer = device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const countStagingBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    commandEncoder.copyBufferToBuffer(colorsBuffer, 0, colorsStagingBuffer, 0, n * 4)
    commandEncoder.copyBufferToBuffer(countBuffer, 0, countStagingBuffer, 0, 4)
    device.queue.submit([commandEncoder.finish()])

    await colorsStagingBuffer.mapAsync(GPUMapMode.READ)
    await countStagingBuffer.mapAsync(GPUMapMode.READ)

    const colorsU8 = new Uint8Array(colorsStagingBuffer.getMappedRange().slice(0))
    const visibleCount = new Uint32Array(countStagingBuffer.getMappedRange().slice(0))[0]

    colorsStagingBuffer.unmap()
    countStagingBuffer.unmap()

    // Cleanup transient buffers
    flagsBuffer.destroy()
    colorsBuffer.destroy()
    countBuffer.destroy()
    uniformBuffer.destroy()
    colorsStagingBuffer.destroy()
    countStagingBuffer.destroy()

    return { colorsU8, visibleCount }
  }

  destroy() {
    this._device?.destroy()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- classifier`
Expected: All tests PASS

---

### Task 7: useSatellites hook

**Files:**
- Create: `src/hooks/useSatellites.js`
- Create: `src/hooks/useSatellites.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useSatellites.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSatellites } from './useSatellites.js'

// Mock the Celestrak API
vi.mock('../api/celestrak.js', () => ({
  fetchTLEData: vi.fn().mockResolvedValue([
    { name: 'SAT-1', line1: '1 00001U 58001B   24001.00000000  .00000000  00000-0  00000-0 0    01', line2: '2 00001  34.2497 290.5428 1845180 175.2184 183.8550 10.84900000    06', isActive: true },
  ]),
}))

// Mock the GPUClassifier
vi.mock('../gpu/classifier.js', () => ({
  GPUClassifier: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn().mockResolvedValue({
      colorsU8: new Uint8Array(4),
      visibleCount: 1,
    }),
    usingFallback: false,
    destroy: vi.fn(),
  })),
}))

// Mock the Web Worker
vi.mock('../workers/satellite.worker.js?worker', () => ({
  default: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    set onmessage(fn) { this._onmessage = fn },
    get onmessage() { return this._onmessage },
  })),
}))

describe('useSatellites', () => {
  it('returns expected shape immediately', () => {
    const { result } = renderHook(() => useSatellites('all'))
    expect(result.current).toMatchObject({
      positionsF32: expect.any(Float32Array),
      colorsU8: expect.any(Uint8Array),
      visibleCount: expect.any(Number),
      totalCount: expect.any(Number),
      loading: expect.any(Boolean),
      error: null,
    })
  })

  it('starts in loading state', () => {
    const { result } = renderHook(() => useSatellites('all'))
    expect(result.current.loading).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- useSatellites`
Expected: FAIL — module not found

- [ ] **Step 3: Create src/hooks/useSatellites.js**

```js
import { useState, useEffect, useRef } from 'react'
import { fetchTLEData } from '../api/celestrak.js'
import { GPUClassifier } from '../gpu/classifier.js'
import SatelliteWorker from '../workers/satellite.worker.js?worker'

const EMPTY_F32 = new Float32Array(0)
const EMPTY_U8 = new Uint8Array(0)

/**
 * Manages satellite data pipeline: TLE fetch -> Web Worker propagation -> GPU classification.
 * @param {'all'|'active'} filterMode - controls which objects are visible
 * @returns {{ positionsF32, colorsU8, visibleCount, totalCount, loading, error }}
 */
export function useSatellites(filterMode) {
  const [positionsF32, setPositionsF32] = useState(EMPTY_F32)
  const [colorsU8, setColorsU8] = useState(EMPTY_U8)
  const [visibleCount, setVisibleCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const workerRef = useRef(null)
  const classifierRef = useRef(null)
  const filterModeRef = useRef(filterMode)
  const latestFlagsRef = useRef(null)

  // Keep filterModeRef in sync and re-classify when filter changes
  useEffect(() => {
    filterModeRef.current = filterMode
    if (latestFlagsRef.current && classifierRef.current) {
      classifierRef.current
        .classify(latestFlagsRef.current, filterMode)
        .then(({ colorsU8: c, visibleCount: v }) => {
          setColorsU8(c)
          setVisibleCount(v)
        })
    }
  }, [filterMode])

  useEffect(() => {
    let destroyed = false
    const classifier = new GPUClassifier()
    classifierRef.current = classifier

    async function setup() {
      await classifier.init()
      if (destroyed) return

      let entries
      try {
        entries = await fetchTLEData()
      } catch (err) {
        if (!destroyed) setError(err)
        setLoading(false)
        return
      }
      if (destroyed) return

      const worker = new SatelliteWorker()
      workerRef.current = worker

      worker.onmessage = async (evt) => {
        if (destroyed) return
        const { positionsF32: pos, activeFlagsU32, count } = evt.data
        latestFlagsRef.current = activeFlagsU32
        setPositionsF32(pos)
        setTotalCount(count)
        const { colorsU8: c, visibleCount: v } = await classifier.classify(
          activeFlagsU32,
          filterModeRef.current
        )
        if (destroyed) return
        setColorsU8(c)
        setVisibleCount(v)
        setLoading(false)
      }

      worker.postMessage({ type: 'init', entries })
    }

    setup()

    return () => {
      destroyed = true
      workerRef.current?.postMessage({ type: 'stop' })
      workerRef.current?.terminate()
      classifierRef.current?.destroy()
    }
  }, [])

  return { positionsF32, colorsU8, visibleCount, totalCount, loading, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- useSatellites`
Expected: All tests PASS

---

## Chunk 3: UI Integration

### Task 8: Add satellite ScatterplotLayer

**Files:**
- Modify: `src/layers/index.js`

- [ ] **Step 1: Write failing test**

Open `src/layers/index.test.js`. The file already defines `mockBinaryTracks` and `vi.mock('@deck.gl/layers', ...)`. Add the following new `describe` block at the bottom of the file, reusing the existing `mockBinaryTracks` fixture:

```js
describe('buildLayers — satellites branch', () => {
  it('includes satellite layer when satellites visible and data present', () => {
    const visibility = { points: false, adsb: false, satellites: true }
    const positionsF32 = new Float32Array([10, 20, 30, 40])
    const colorsU8 = new Uint8Array([0, 255, 140, 217, 0, 255, 140, 217])
    const data = {
      points: [],
      adsbTracks: mockBinaryTracks,
      adsbPositions: [],
      satellitePositions: positionsF32,
      satelliteColors: colorsU8,
      satelliteCount: 2,
    }
    const layers = buildLayers(visibility, data, () => {})
    expect(layers.some((l) => l.id === 'satellites')).toBe(true)
  })

  it('excludes satellite layer when satellites not visible', () => {
    const visibility = { points: false, adsb: false, satellites: false }
    const data = {
      points: [],
      adsbTracks: mockBinaryTracks,
      adsbPositions: [],
      satellitePositions: new Float32Array(0),
      satelliteColors: new Uint8Array(0),
      satelliteCount: 0,
    }
    const layers = buildLayers(visibility, data, () => {})
    expect(layers.some((l) => l.id === 'satellites')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- layers/index`
Expected: FAIL — satellite layer not present

- [ ] **Step 3: Update src/layers/index.js**

```js
import { ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool, adsb: bool, satellites: bool }
 * @param {Object} data - { points, adsbTracks, adsbPositions, satellitePositions, satelliteColors, satelliteCount }
 * @param {Function} onFeatureClick - called with the clicked feature object
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.points) {
    layers.push(
      new ScatterplotLayer({
        id: 'ais-vessels',
        data: data.points ?? [],
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: [255, 140, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  if (layerVisibility.adsb) {
    layers.push(
      new PathLayer({
        id: 'adsb-tracks',
        data: data.adsbTracks,
        _pathType: 'open',
        getWidth: 1,
        widthUnits: 'pixels',
        getColor: [0, 180, 255, 160],
      }),
      new TextLayer({
        id: 'adsb-icons',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getText: () => '\u2708',
        getAngle: (d) => 90 - (d.heading ?? 0),
        getSize: 14,
        getColor: [0, 220, 255, 220],
        billboard: false,
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      }),
      new TextLayer({
        id: 'adsb-labels',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => [d.callsign, d.country].filter(Boolean).join('\n'),
        getSize: 10,
        getColor: [0, 220, 255, 160],
        getPixelOffset: [0, 14],
        billboard: false,
        pickable: false,
      })
    )
  }

  if (layerVisibility.satellites && data.satelliteCount > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'satellites',
        data: {
          length: data.satelliteCount,
          attributes: {
            getPosition: { value: data.satellitePositions, size: 2 },
            getFillColor: { value: data.satelliteColors, size: 4, normalized: false },
          },
        },
        getRadius: 3,
        radiusUnits: 'pixels',
        pickable: false,
        updateTriggers: {
          getPosition: data.satellitePositions,
          getFillColor: data.satelliteColors,
        },
      })
    )
  }

  return layers
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- layers/index`
Expected: All tests PASS

---

### Task 9: Update LayerPanel with satellite sub-toggle

**Files:**
- Modify: `src/components/LayerPanel.jsx`

- [ ] **Step 1: Read the existing LayerPanel test file**

Run: `cat src/components/LayerPanel.test.jsx`
Expected: See the existing import block and test structure so new tests follow the same render/screen pattern.

- [ ] **Step 2: Write failing tests**

Open `src/components/LayerPanel.test.jsx` and add the following new tests inside the existing describe block (or as a new describe block), matching the file's existing import and render pattern:

```js
  it('renders satellite filter sub-toggle when satellites layer is active', () => {
    const visibility = { points: true, adsb: true, satellites: true }
    render(
      <LayerPanel
        visibility={visibility}
        onToggle={() => {}}
        satelliteFilter="all"
        onSatelliteFilterChange={() => {}}
      />
    )
    expect(screen.getByText(/ALL OBJ/i)).toBeInTheDocument()
    expect(screen.getByText(/ACTIVE/i)).toBeInTheDocument()
  })

  it('does not render satellite sub-toggle when satellites layer is off', () => {
    const visibility = { points: true, adsb: true, satellites: false }
    render(
      <LayerPanel
        visibility={visibility}
        onToggle={() => {}}
        satelliteFilter="all"
        onSatelliteFilterChange={() => {}}
      />
    )
    expect(screen.queryByText(/ALL OBJ/i)).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- LayerPanel`
Expected: FAIL — sub-toggle elements not found

- [ ] **Step 4: Update `src/components/LayerPanel.jsx`**

```js
import { LAYERS } from '../config/sources.js'

const LAYER_COLORS = {
  points: 'var(--amber)',
  adsb: 'var(--blue)',
  satellites: 'var(--green)',
}

export function LayerPanel({ visibility, onToggle, satelliteFilter, onSatelliteFilterChange }) {
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
          <div key={id}>
            <label className={`layer-row${active ? ' active' : ''}`}>
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
            {id === 'satellites' && active && (
              <div className="layer-sub-row">
                <button
                  className={`sub-toggle${satelliteFilter === 'all' ? ' active' : ''}`}
                  onClick={() => onSatelliteFilterChange('all')}
                >
                  ALL OBJ
                </button>
                <button
                  className={`sub-toggle${satelliteFilter === 'active' ? ' active' : ''}`}
                  onClick={() => onSatelliteFilterChange('active')}
                >
                  ACTIVE
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div className="panel-footer">
        <span className="footer-stat">
          ACTIVE&nbsp;{activeCount}/{totalCount}
        </span>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: Add sub-toggle styles to `src/index.css`**

Open `src/index.css`. Search for the `.layer-toggle` rule block. Insert the following CSS immediately after the closing `}` of that block:

```css
.layer-sub-row {
  display: flex;
  gap: 4px;
  padding: 2px 8px 6px 28px;
}

.sub-toggle {
  flex: 1;
  padding: 2px 6px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.05em;
  background: transparent;
  border: 1px solid var(--text-dim, #555);
  color: var(--text-dim, #555);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.sub-toggle.active {
  border-color: var(--green, #00ff8c);
  color: var(--green, #00ff8c);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- LayerPanel`
Expected: All tests PASS

---

### Task 10: Wire up App.jsx and MapView.jsx

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/MapView.jsx`

- [ ] **Step 1: Update App.jsx**

Open `src/App.jsx` and update to pull satellite state from the store and pass it through:

```js
import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useAIS } from './hooks/useAIS.js'
import { useADSB } from './hooks/useADSB.js'
import { useSatellites } from './hooks/useSatellites.js'

function Header() {
  const viewport = useMapStore((s) => s.viewport)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const utc = time.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
  const lat = Math.abs(viewport.latitude).toFixed(4) + (viewport.latitude >= 0 ? '\u00b0N' : '\u00b0S')
  const lon = Math.abs(viewport.longitude).toFixed(4) + (viewport.longitude >= 0 ? '\u00b0E' : '\u00b0W')

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="classification-badge">UNCLASSIFIED</span>
        <span className="header-sep">\u25c6</span>
        <span className="header-status">
          SYS&nbsp;<span className="ok">NOMINAL</span>
        </span>
      </div>

      <div className="header-center">
        <span className="app-title">WebGPU Groundtruth</span>
      </div>

      <div className="header-right">
        <span className="coord-display">{lat}&nbsp;&nbsp;{lon}</span>
        <span className="header-sep">\u25c6</span>
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
    satelliteFilter,
    setSatelliteFilter,
  } = useMapStore()

  const { vessels } = useAIS()
  const { binaryTracks, currentPositions } = useADSB()
  const { positionsF32, colorsU8, visibleCount, totalCount } = useSatellites(satelliteFilter)

  const layerData = {
    points: vessels,
    adsbTracks: binaryTracks,
    adsbPositions: currentPositions,
    satellitePositions: positionsF32,
    satelliteColors: colorsU8,
    satelliteCount: totalCount,
    satelliteVisibleCount: visibleCount,
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <MapView layerData={layerData} />
        <LayerPanel
          visibility={layerVisibility}
          onToggle={setLayerVisibility}
          satelliteFilter={satelliteFilter}
          onSatelliteFilterChange={setSatelliteFilter}
        />
        <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update MapView.jsx to include satellite count**

Open `src/components/MapView.jsx`. Find the existing `activePointCount` assignment (it reads `points?.length` and `adsbPositions?.length`). Replace that entire block with:

```js
const activePointCount =
  (layerVisibility.points ? (layerData.points?.length ?? 0) : 0) +
  (layerVisibility.adsb ? (layerData.adsbPositions?.length ?? 0) : 0) +
  (layerVisibility.satellites ? (layerData.satelliteVisibleCount ?? 0) : 0)
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS with no regressions

- [ ] **Step 4: Verify the app runs in the browser**

Run: `npm run dev`
Open the browser. Verify:
- Satellites layer appears in the LayerPanel
- ALL OBJ / ACTIVE sub-toggle appears when satellites is ON
- After ~10-15 seconds (TLE fetch + propagation), satellite points appear on the map
- The PTS counter in GPUInfoPanel increases to reflect satellite count
- Toggling to ACTIVE reduces the visible count

---

## Done

All three chunks complete. The satellite constellation layer is integrated into the existing app with:
- WebGPU compute classification (CPU fallback when unavailable)
- Live point-count metrics via the existing GPUInfoPanel PTS counter
- All/active filter toggle in LayerPanel
- Zero regressions in existing tests