# Data Layer Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken AIS/ADS-B layers with three reliable, auth-free data sources (Celestrak satellites, OurAirports CSV, bundled ports GeoJSON) rendering ~33,500 points to showcase WebGPU rendering performance.

**Architecture:** Satellites are fetched via a Vite dev proxy and propagated every 10s in a Web Worker, posting binary typed arrays to the main thread. Airports are fetched once from GitHub raw (CORS-friendly CSV). Ports are served from a bundled static asset. All three feed into three ScatterplotLayers replacing the existing AIS/ADS-B layers.

**Tech Stack:** React + Vite, deck.gl, satellite.js, Zustand, Vitest

---

## Chunk 1: Foundation

### Task 1: Install satellite.js and update vite.config.js

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `vite.config.js`

- [ ] **Step 1: Install satellite.js**

Run: `npm install satellite.js`
Expected: `satellite.js` appears in `dependencies` in `package.json`

- [ ] **Step 2: Update vite.config.js to add Celestrak proxy**

Replace the contents of `vite.config.js` with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['deck.gl', '@deck.gl/react', '@deck.gl/mapbox', '@deck.gl/layers', '@luma.gl/webgpu'],
    include: ['earcut'],
  },
  server: {
    proxy: {
      '/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})
```

- [ ] **Step 3: Verify the dev server still starts**

Run: `npx vite --version`
Expected: prints vite version without error

---

### Task 2: Replace src/config/sources.js

**Files:**
- Modify: `src/config/sources.js`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/config/sources.js` with:

```js
// Satellite TLE data — Celestrak GP elements catalog. Requires Vite proxy in dev.
export const CELESTRAK_TLE_URL = '/celestrak/pub/TLE/catalog.txt'
// Interval between satellite position propagations (ms)
export const SATELLITE_PROPAGATE_INTERVAL = 10_000

// Airport data — OurAirports public domain CSV. GitHub raw serves with permissive CORS.
export const OURAIRPORTS_CSV_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv'

// Sea ports — bundled static GeoJSON asset (NGA World Port Index, public domain)
export const WORLD_PORTS_URL = '/data/ports.geojson'

export const LAYERS = {
  SATELLITES: { id: 'satellites', label: 'Satellites' },
  AIRPORTS:   { id: 'airports',   label: 'Airports' },
  PORTS:      { id: 'ports',      label: 'Sea Ports' },
}

// Free dark vector basemap — no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center — global view
export const DEFAULT_VIEW = {
  longitude: 0,
  latitude: 20,
  zoom: 2,
}
```

---

### Task 3: Add --green CSS variable

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add the --green variable after --blue**

In `src/index.css`, find the line `--blue: #00aaff;` and add the green variable immediately after it:

```css
  --blue:          #00aaff;
  --green:         #00ff8c;
```

---

### Task 4: Bundle ports.geojson as static asset

**Files:**
- Create: `public/data/ports.geojson`

- [ ] **Step 1: Create the data directory and download ports GeoJSON**

Run:
```bash
mkdir -p public/data
curl -L "https://raw.githubusercontent.com/datasets/geo-ports/master/data/ports.geojson" -o public/data/ports.geojson
```

Expected: `public/data/ports.geojson` exists and contains a GeoJSON FeatureCollection. Verify with:
```bash
head -c 200 public/data/ports.geojson
```
Expected output starts with `{"type":"FeatureCollection"` and includes feature objects with geometry coordinates.

- [ ] **Step 2: If the download fails, use the NGA WPI alternative**

If the curl above returns an error or non-JSON content, run instead:
```bash
curl -L "https://msi.nga.mil/api/publications/download?key=16920959/SFH00000/WPI.geojson&type=view" -o public/data/ports.geojson
```

The GeoJSON must have Point features with a name property. Either `PORT_NAME` or `name` is acceptable — `usePorts.js` (Task 8) will read whichever is present.

---

## Chunk 2: Satellite Layer

### Task 5: Create src/workers/satelliteWorker.js

**Files:**
- Create: `src/workers/satelliteWorker.js`

No unit test for the worker entry point itself (Web Workers can't run in jsdom). The worker logic is straightforward and is covered by integration when the app runs.

- [ ] **Step 1: Create the worker file**

Create `src/workers/satelliteWorker.js` with:

```js
import * as satellite from 'satellite.js'

let satrecs = []

/**
 * Parses a 3-line TLE text block into an array of { name, satrec } objects.
 * Silently skips malformed entries.
 *
 * @param {string} text - raw TLE catalog text
 * @returns {Array<{ name: string, satrec: Object }>}
 */
function parseTLEs(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const result = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue
    try {
      const satrec = satellite.twoline2satrec(line1, line2)
      result.push({ name, satrec })
    } catch {
      // malformed TLE — skip
    }
  }
  return result
}

/**
 * Propagates all stored satrecs to the given Date.
 * Returns a Float32Array of interleaved [lon, lat, lon, lat, ...] in degrees.
 *
 * @param {Date} date
 * @returns {Float32Array}
 */
function propagate(date) {
  const gmst = satellite.gstime(date)
  const positions = []
  for (const { satrec } of satrecs) {
    const posVel = satellite.propagate(satrec, date)
    if (!posVel.position || posVel.position === false) continue
    const geo = satellite.eciToGeodetic(posVel.position, gmst)
    const lon = satellite.degreesLong(geo.longitude)
    const lat = satellite.degreesLat(geo.latitude)
    if (!isFinite(lon) || !isFinite(lat)) continue
    positions.push(lon, lat)
  }
  return new Float32Array(positions)
}

self.onmessage = (e) => {
  const { type } = e.data

  if (type === 'init') {
    try {
      satrecs = parseTLEs(e.data.tleText)
      const positions = propagate(new Date())
      self.postMessage({ type: 'positions', positions, count: positions.length / 2 }, [positions.buffer])
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message })
    }
    return
  }

  if (type === 'propagate') {
    try {
      const positions = propagate(new Date(e.data.time))
      self.postMessage({ type: 'positions', positions, count: positions.length / 2 }, [positions.buffer])
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message })
    }
  }
}
```

---

### Task 6: Create src/hooks/useSatellites.js

**Files:**
- Create: `src/hooks/useSatellites.js`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useSatellites.js` with:

```js
import { useState, useEffect, useRef } from 'react'
import { CELESTRAK_TLE_URL, SATELLITE_PROPAGATE_INTERVAL } from '../config/sources.js'

const EMPTY_SATELLITES = {
  length: 0,
  attributes: { getPosition: { value: new Float32Array(0), size: 2 } },
}

/**
 * Fetches Celestrak TLE data and propagates satellite positions in a Web Worker
 * every SATELLITE_PROPAGATE_INTERVAL ms.
 *
 * Returns { satellites, count, connected, error }
 *   satellites - deck.gl binary columnar object: { length, attributes: { getPosition } }
 *   count      - number of successfully propagated satellites
 *   connected  - true after first successful propagation
 *   error      - Error if the last operation failed, null otherwise
 */
export function useSatellites() {
  const [satellites, setSatellites] = useState(EMPTY_SATELLITES)
  const [count, setCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const workerRef = useRef(null)

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/satelliteWorker.js', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (e) => {
      const { type, positions, count: cnt, message } = e.data
      if (type === 'positions') {
        setSatellites({
          length: cnt,
          attributes: { getPosition: { value: positions, size: 2 } },
        })
        setCount(cnt)
        setConnected(true)
        setError(null)
      } else if (type === 'error') {
        setError(new Error(message))
      }
    }

    worker.onerror = (e) => setError(new Error(e.message))

    async function init() {
      try {
        const res = await fetch(CELESTRAK_TLE_URL)
        if (!res.ok) throw new Error(`TLE fetch failed: ${res.status} ${res.statusText}`)
        const tleText = await res.text()
        worker.postMessage({ type: 'init', tleText })
      } catch (err) {
        setError(err)
      }
    }

    init()

    const intervalId = setInterval(() => {
      worker.postMessage({ type: 'propagate', time: Date.now() })
    }, SATELLITE_PROPAGATE_INTERVAL)

    return () => {
      worker.terminate()
      clearInterval(intervalId)
    }
  }, [])

  return { satellites, count, connected, error }
}
```

---

## Chunk 3: Airport and Port Hooks

### Task 7: Create src/hooks/useAirports.js (with tests)

**Files:**
- Create: `src/hooks/useAirports.js`
- Create: `src/hooks/useAirports.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useAirports.test.js` with:

```js
import { describe, it, expect } from 'vitest'
import { parseAirportCSV } from './useAirports.js'

const SAMPLE_CSV = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent',
  '1,KLAX,large_airport,Los Angeles International Airport,33.9425,-118.4081,125,NA',
  '2,KSFO,large_airport,San Francisco International Airport,37.6188,-122.3750,13,NA',
  '3,ZZZZ,closed,Closed Airport,0.0,0.0,0,NA',
  '4,KABC,small_airport,"City of, State Airport",10.0,20.0,100,NA',
].join('\n')

describe('parseAirportCSV', () => {
  it('returns an array', () => {
    expect(Array.isArray(parseAirportCSV(SAMPLE_CSV))).toBe(true)
  })

  it('filters out closed airports', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result.every((a) => a.type !== 'closed')).toBe(true)
  })

  it('parses lon and lat as numbers', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].lon).toBe(-118.4081)
    expect(result[0].lat).toBe(33.9425)
  })

  it('parses name and type strings', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].name).toBe('Los Angeles International Airport')
    expect(result[0].type).toBe('large_airport')
  })

  it('handles quoted names with embedded commas', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    const quoted = result.find((a) => a.name === 'City of, State Airport')
    expect(quoted).toBeDefined()
  })

  it('filters rows with invalid lon/lat', () => {
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft',
      '1,XBAD,small_airport,Bad Airport,,20.0,0',
    ].join('\n')
    const result = parseAirportCSV(csv)
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useAirports.test.js`
Expected: FAIL — `parseAirportCSV is not a function` or module not found

- [ ] **Step 3: Create useAirports.js**

Create `src/hooks/useAirports.js` with:

```js
import { useState, useEffect } from 'react'
import { OURAIRPORTS_CSV_URL } from '../config/sources.js'

/**
 * Parses a single CSV row, respecting double-quoted fields that may contain commas.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVRow(line) {
  const result = []
  let inQuotes = false
  let current = ''
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/**
 * Parses OurAirports airports.csv text.
 * Filters out closed airports and rows with missing coordinates.
 * Field order: id(0), ident(1), type(2), name(3), latitude_deg(4), longitude_deg(5)
 *
 * @param {string} text - raw CSV text including header row
 * @returns {Array<{ lon: number, lat: number, name: string, type: string }>}
 */
export function parseAirportCSV(text) {
  const lines = text.split('\n')
  const result = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const fields = parseCSVRow(line)
    const type = fields[2]
    if (type === 'closed') continue
    const lat = parseFloat(fields[4])
    const lon = parseFloat(fields[5])
    if (!isFinite(lat) || !isFinite(lon)) continue
    result.push({ lon, lat, name: fields[3], type })
  }
  return result
}

/**
 * Fetches and parses the OurAirports CSV once on mount.
 *
 * Returns { airports, loaded, error }
 *   airports - Array<{ lon, lat, name, type }>
 *   loaded   - true after successful fetch
 *   error    - Error if fetch failed, null otherwise
 */
export function useAirports() {
  const [airports, setAirports] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(OURAIRPORTS_CSV_URL)
        if (!res.ok) throw new Error(`Airport fetch failed: ${res.status} ${res.statusText}`)
        const text = await res.text()
        if (cancelled) return
        setAirports(parseAirportCSV(text))
        setLoaded(true)
      } catch (err) {
        if (!cancelled) setError(err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { airports, loaded, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useAirports.test.js`
Expected: all 6 tests PASS

---

### Task 8: Create src/hooks/usePorts.js

**Files:**
- Create: `src/hooks/usePorts.js`

No separate unit test for this hook — the parsing is a one-liner over a known GeoJSON shape and is verified by the running app.

- [ ] **Step 1: Create usePorts.js**

Create `src/hooks/usePorts.js` with:

```js
import { useState, useEffect } from 'react'
import { WORLD_PORTS_URL } from '../config/sources.js'

/**
 * Fetches the bundled World Port Index GeoJSON once on mount.
 * Parses Point features into a flat array.
 *
 * Returns { ports, loaded, error }
 *   ports  - Array<{ lon: number, lat: number, name: string }>
 *   loaded - true after successful parse
 *   error  - Error if fetch failed, null otherwise
 */
export function usePorts() {
  const [ports, setPorts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(WORLD_PORTS_URL)
        if (!res.ok) throw new Error(`Ports fetch failed: ${res.status} ${res.statusText}`)
        const geojson = await res.json()
        if (cancelled) return
        const parsed = geojson.features
          .filter((f) => f.geometry?.type === 'Point')
          .map((f) => ({
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            // NGA WPI uses PORT_NAME; fall back to name for other datasets
            name: f.properties?.PORT_NAME ?? f.properties?.name ?? '',
          }))
          .filter((p) => isFinite(p.lon) && isFinite(p.lat))
        setPorts(parsed)
        setLoaded(true)
      } catch (err) {
        if (!cancelled) setError(err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { ports, loaded, error }
}
```

---

## Chunk 4: Layers and Wiring

### Task 9: Rewrite src/layers/index.js (TDD)

**Files:**
- Modify: `src/layers/index.js`
- Modify: `src/layers/index.test.js`

- [ ] **Step 1: Replace index.test.js with new tests**

Replace the entire contents of `src/layers/index.test.js` with:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
}))

import { buildLayers } from './index.js'

const mockSatellites = {
  length: 5,
  attributes: { getPosition: { value: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), size: 2 } },
}

const mockAirport = { lon: 10, lat: 20, name: 'Test Airport', type: 'large_airport' }
const mockPort = { lon: 30, lat: 40, name: 'Test Port' }

describe('buildLayers', () => {
  it('returns an array', () => {
    const layers = buildLayers(
      { satellites: true, airports: true, ports: true },
      { satellites: mockSatellites, airports: [mockAirport], ports: [mockPort] },
      vi.fn()
    )
    expect(Array.isArray(layers)).toBe(true)
  })

  it('includes satellites layer when visible', () => {
    const layers = buildLayers(
      { satellites: true, airports: false, ports: false },
      { satellites: mockSatellites, airports: [], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('satellites')
  })

  it('omits satellites layer when not visible', () => {
    const layers = buildLayers(
      { satellites: false, airports: false, ports: false },
      { satellites: mockSatellites, airports: [], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('satellites')
  })

  it('satellites layer is not pickable', () => {
    const layers = buildLayers(
      { satellites: true, airports: false, ports: false },
      { satellites: mockSatellites, airports: [], ports: [] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'satellites')
    expect(layer.props.pickable).toBe(false)
  })

  it('includes airports layer when visible', () => {
    const layers = buildLayers(
      { satellites: false, airports: true, ports: false },
      { satellites: mockSatellites, airports: [mockAirport], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('airports')
  })

  it('omits airports layer when not visible', () => {
    const layers = buildLayers(
      { satellites: false, airports: false, ports: false },
      { satellites: mockSatellites, airports: [mockAirport], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('airports')
  })

  it('airports onClick wraps object in properties envelope', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { satellites: false, airports: true, ports: false },
      { satellites: mockSatellites, airports: [mockAirport], ports: [] },
      handler
    )
    const layer = layers.find((l) => l.id === 'airports')
    layer.props.onClick({ object: mockAirport })
    expect(handler).toHaveBeenCalledWith({ properties: mockAirport })
  })

  it('airports onClick does not fire when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { satellites: false, airports: true, ports: false },
      { satellites: mockSatellites, airports: [mockAirport], ports: [] },
      handler
    )
    const layer = layers.find((l) => l.id === 'airports')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })

  it('includes ports layer when visible', () => {
    const layers = buildLayers(
      { satellites: false, airports: false, ports: true },
      { satellites: mockSatellites, airports: [], ports: [mockPort] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('ports')
  })

  it('omits ports layer when not visible', () => {
    const layers = buildLayers(
      { satellites: false, airports: false, ports: false },
      { satellites: mockSatellites, airports: [], ports: [mockPort] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('ports')
  })

  it('ports onClick wraps object in properties envelope', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { satellites: false, airports: false, ports: true },
      { satellites: mockSatellites, airports: [], ports: [mockPort] },
      handler
    )
    const layer = layers.find((l) => l.id === 'ports')
    layer.props.onClick({ object: mockPort })
    expect(handler).toHaveBeenCalledWith({ properties: mockPort })
  })

  it('ports onClick does not fire when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { satellites: false, airports: false, ports: true },
      { satellites: mockSatellites, airports: [], ports: [mockPort] },
      handler
    )
    const layer = layers.find((l) => l.id === 'ports')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })

  it('all three layers present when all visible', () => {
    const layers = buildLayers(
      { satellites: true, airports: true, ports: true },
      { satellites: mockSatellites, airports: [mockAirport], ports: [mockPort] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).toContain('satellites')
    expect(ids).toContain('airports')
    expect(ids).toContain('ports')
    expect(layers).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/layers/index.test.js`
Expected: FAIL — tests import old layer IDs (`ais-vessels` etc.) that no longer match

- [ ] **Step 3: Replace src/layers/index.js**

Replace the entire contents of `src/layers/index.js` with:

```js
import { ScatterplotLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 *
 * @param {Object} layerVisibility - { satellites: bool, airports: bool, ports: bool }
 * @param {Object} data - { satellites: BinaryColumnarData, airports: Array, ports: Array }
 * @param {Function} onFeatureClick - called with { properties: object } on click
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.satellites) {
    layers.push(
      new ScatterplotLayer({
        id: 'satellites',
        data: data.satellites,
        getRadius: 3,
        radiusUnits: 'pixels',
        getFillColor: [0, 220, 255, 180],
        pickable: false,
      })
    )
  }

  if (layerVisibility.airports) {
    layers.push(
      new ScatterplotLayer({
        id: 'airports',
        data: data.airports ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [255, 180, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      })
    )
  }

  if (layerVisibility.ports) {
    layers.push(
      new ScatterplotLayer({
        id: 'ports',
        data: data.ports ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [0, 255, 140, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      })
    )
  }

  return layers
}
```

- [ ] **Step 4: Run the layer tests to verify they pass**

Run: `npx vitest run src/layers/index.test.js`
Expected: all 13 tests PASS

---

### Task 10: Update src/store/mapStore.js and its tests

**Files:**
- Modify: `src/store/mapStore.js`
- Modify: `src/store/mapStore.test.js`

- [ ] **Step 1: Update mapStore.test.js**

Replace the contents of `src/store/mapStore.test.js` with:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from './mapStore'

describe('mapStore', () => {
  beforeEach(() => {
    useMapStore.setState(useMapStore.getInitialState())
  })

  it('has default viewport', () => {
    const { viewport } = useMapStore.getState()
    expect(viewport.zoom).toBe(2)
    expect(typeof viewport.longitude).toBe('number')
    expect(typeof viewport.latitude).toBe('number')
  })

  it('setViewport updates viewport', () => {
    const { setViewport } = useMapStore.getState()
    setViewport({ longitude: 10, latitude: 20, zoom: 8, pitch: 0, bearing: 0 })
    const { viewport } = useMapStore.getState()
    expect(viewport.zoom).toBe(8)
    expect(viewport.longitude).toBe(10)
  })

  it('has default layer visibility for all three layers', () => {
    const { layerVisibility } = useMapStore.getState()
    expect(layerVisibility.satellites).toBe(true)
    expect(layerVisibility.airports).toBe(true)
    expect(layerVisibility.ports).toBe(true)
  })

  it('setLayerVisibility toggles a layer', () => {
    const { setLayerVisibility } = useMapStore.getState()
    setLayerVisibility('satellites', false)
    expect(useMapStore.getState().layerVisibility.satellites).toBe(false)
  })

  it('setSelectedFeature stores feature', () => {
    const { setSelectedFeature } = useMapStore.getState()
    const feature = { id: '1', properties: { name: 'Test' } }
    setSelectedFeature(feature)
    expect(useMapStore.getState().selectedFeature).toEqual(feature)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/mapStore.test.js`
Expected: FAIL on `viewport.zoom toBe(2)` and `layerVisibility.satellites toBe(true)`

- [ ] **Step 3: Update mapStore.js**

In `src/store/mapStore.js`, replace the `layerVisibility` block in `initialState`:

Find:
```js
  layerVisibility: {
    points: true,
    adsb: true,
  },
```

Replace with:
```js
  layerVisibility: {
    satellites: true,
    airports: true,
    ports: true,
  },
```

The `DEFAULT_VIEW` zoom is now `2` (set in sources.js), so no change needed in mapStore itself — it reads from the config.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/store/mapStore.test.js`
Expected: all 5 tests PASS

---

### Task 11: Update src/App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Update App.jsx imports and hook usage**

Replace the entire contents of `src/App.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useSatellites } from './hooks/useSatellites.js'
import { useAirports } from './hooks/useAirports.js'
import { usePorts } from './hooks/usePorts.js'

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
  const { layerVisibility, setLayerVisibility, selectedFeature, setSelectedFeature } = useMapStore()

  const { satellites } = useSatellites()
  const { airports } = useAirports()
  const { ports } = usePorts()

  const layerData = {
    satellites,
    airports,
    ports,
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

---

### Task 12: Update src/components/MapView.jsx

**Files:**
- Modify: `src/components/MapView.jsx`

- [ ] **Step 1: Update the activePointCount calculation**

In `src/components/MapView.jsx`, find:

```js
  const activePointCount =
    (layerVisibility.points ? (layerData.points?.length ?? 0) : 0) +
    (layerVisibility.adsb ? (layerData.adsbPositions?.length ?? 0) : 0)
```

Replace with:

```js
  const activePointCount =
    (layerVisibility.satellites ? (layerData.satellites?.length ?? 0) : 0) +
    (layerVisibility.airports   ? (layerData.airports?.length ?? 0)   : 0) +
    (layerVisibility.ports      ? (layerData.ports?.length ?? 0)      : 0)
```

---

### Task 13: Update src/components/LayerPanel.jsx

**Files:**
- Modify: `src/components/LayerPanel.jsx`

- [ ] **Step 1: Update LAYER_COLORS**

In `src/components/LayerPanel.jsx`, find:

```js
const LAYER_COLORS = {
  points: 'var(--amber)',
  adsb: 'var(--blue)',
}
```

Replace with:

```js
const LAYER_COLORS = {
  satellites: 'var(--blue)',
  airports:   'var(--amber)',
  ports:      'var(--green)',
}
```

---

## Chunk 5: Cleanup

### Task 14: Delete old files

**Files:**
- Delete: `src/api/ais.js`
- Delete: `src/api/opensky.js`
- Delete: `src/api/opensky.test.js`
- Delete: `src/hooks/useAIS.js`
- Delete: `src/hooks/useADSB.js`

- [ ] **Step 1: Delete the old API and hook files**

Run:
```bash
rm src/api/ais.js src/api/opensky.js src/api/opensky.test.js src/hooks/useAIS.js src/hooks/useADSB.js
```

Expected: no output, files removed

---

### Task 15: Full test run and app verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: all tests pass — no references to `points`, `adsb`, `ais-vessels`, `adsb-tracks`, or old layer IDs should appear in failures

- [ ] **Step 2: Start the dev server and verify the app loads**

Run: `npx vite`
Expected: server starts on `http://localhost:5173` (or similar), no console errors about missing modules

- [ ] **Step 3: Verify satellite data loads**

Open the app in a browser. Within 30 seconds, the Satellites layer should show points appearing on the globe. The LayerPanel should show three toggles: SATELLITES, AIRPORTS, SEA PORTS.

- [ ] **Step 4: Verify airport and port data loads**

Toggle AIRPORTS and SEA PORTS off and on. Points should appear/disappear. Clicking an airport or port should open the FeaturePopup with `name` and `type` fields.

- [ ] **Step 5: Verify point count in GPU info panel**

The GPU info panel should show an `activePointCount` in the tens of thousands when all layers are on.