# ADS-B Tracks Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live ADS-B aircraft tracks via OpenSky Network, rendered as binary PathLayer trails with ScatterplotLayer position dots.

**Architecture:** A fetch wrapper (`opensky.js`) polls OpenSky every 10 seconds and normalizes the flat state vector array. A pure `buildBinaryTracks` function in the same file transforms the accumulated track map into deck.gl's typed array binary format. A hook (`useADSB.js`) owns accumulation, rolling window pruning, and flush timing. `App.jsx` wires it into `layerData` alongside the existing AIS layer.

**Tech Stack:** React 19, deck.gl 9.2 (PathLayer + ScatterplotLayer), luma.gl WebGPU, Zustand, Vitest

---

## Chunk 1: Config, API, and binary encoding

### Task 1: Update `src/config/sources.js`

**Files:**
- Modify: `src/config/sources.js`

Add OpenSky constants and the ADSB entry to LAYERS. The AIS constants and BASEMAP_STYLE are unchanged.

- [ ] **Replace `src/config/sources.js`**

```js
// AIS data — aisstream.io global WebSocket feed. Requires VITE_AISSTREAM_API_KEY in .env.local
export const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream'
// Bounding box format: [[[lat, lon], [lat, lon]]] — latitude first (aisstream convention)
export const AISSTREAM_BOUNDING_BOX = [[[-90, -180], [90, 180]]]
// Flush accumulated vessel positions to React state at this interval (ms)
export const AISSTREAM_FLUSH_INTERVAL = 1_000

// ADS-B data — OpenSky Network anonymous REST feed. No auth required.
export const OPENSKY_URL = 'https://opensky-network.org/api/states/all'
// Anonymous tier minimum poll interval (registered accounts can use 5s)
export const OPENSKY_POLL_INTERVAL = 10_000
// Flush accumulated tracks to React state at this interval (ms)
export const OPENSKY_FLUSH_INTERVAL = 1_000
// Maximum position history per aircraft (rolling window, oldest dropped)
export const OPENSKY_MAX_TRACK_POINTS = 20

export const LAYERS = {
  AIS: {
    id: 'points',
    label: 'AIS Vessels',
  },
  ADSB: {
    id: 'adsb',
    label: 'ADS-B Aircraft',
  },
}

// Free dark vector basemap — no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center
export const DEFAULT_VIEW = {
  longitude: 119.4179,
  latitude: 24.3963,
  zoom: 6,
}
```

- [ ] **Run store and LayerPanel tests to confirm they still pass**

```bash
npx vitest run src/store/mapStore.test.js src/components/LayerPanel.test.jsx
```

Expected: all tests pass. `LayerPanel.test.jsx` drives off `Object.values(LAYERS)` so the new ADSB entry renders automatically; the test checking `getAllByRole('checkbox')[0]` still refers to the AIS row (insertion order preserved).

---

### Task 2: Write failing tests for `buildBinaryTracks`

**Files:**
- Create: `src/api/opensky.test.js`

Write the tests before the implementation. They will fail because `opensky.js` does not exist yet.

- [ ] **Create `src/api/opensky.test.js`**

```js
import { describe, it, expect } from 'vitest'
import { buildBinaryTracks } from './opensky.js'

describe('buildBinaryTracks', () => {
  it('returns empty binary for an empty map', () => {
    const result = buildBinaryTracks(new Map())
    expect(result.length).toBe(0)
    expect(result.startIndices).toBeInstanceOf(Uint32Array)
    expect(result.startIndices.length).toBe(1)
    expect(result.startIndices[0]).toBe(0)
    expect(result.attributes.getPath.value).toBeInstanceOf(Float32Array)
    expect(result.attributes.getPath.value.length).toBe(0)
    expect(result.attributes.getPath.size).toBe(2)
  })

  it('excludes single-point tracks (PathLayer requires 2+ vertices)', () => {
    const map = new Map([['abc123', [[10, 20]]]])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(0)
    expect(result.attributes.getPath.value.length).toBe(0)
  })

  it('encodes a single two-point track', () => {
    const map = new Map([['abc123', [[10, 20], [11, 21]]]])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(1)
    expect(result.startIndices).toEqual(new Uint32Array([0, 2]))
    expect(result.attributes.getPath.value).toEqual(new Float32Array([10, 20, 11, 21]))
  })

  it('encodes two tracks with correct startIndices', () => {
    const map = new Map([
      ['abc', [[0, 0], [1, 1], [2, 2]]],
      ['def', [[10, 10], [11, 11]]],
    ])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(2)
    // startIndices has length + 1 entries: [0, 3, 5]
    expect(result.startIndices).toEqual(new Uint32Array([0, 3, 5]))
    // (3 + 2) vertices * 2 components = 10 floats
    expect(result.attributes.getPath.value.length).toBe(10)
    expect(result.attributes.getPath.value[0]).toBe(0)   // first path, first lng
    expect(result.attributes.getPath.value[1]).toBe(0)   // first path, first lat
    expect(result.attributes.getPath.value[6]).toBe(10)  // second path, first lng
    expect(result.attributes.getPath.value[7]).toBe(10)  // second path, first lat
  })

  it('skips single-point tracks when mixed with valid tracks', () => {
    const map = new Map([
      ['solo', [[5, 5]]],
      ['pair', [[1, 2], [3, 4]]],
    ])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(1)
    expect(result.attributes.getPath.value).toEqual(new Float32Array([1, 2, 3, 4]))
  })
})
```

- [ ] **Run the tests to confirm they fail**

```bash
npx vitest run src/api/opensky.test.js
```

Expected: FAIL — `Cannot find module './opensky.js'`

---

### Task 3: Create `src/api/opensky.js`

**Files:**
- Create: `src/api/opensky.js`

Implement both `fetchOpenSky` and `buildBinaryTracks`. The fetch wrapper normalizes the flat OpenSky state vector array into named objects and filters aircraft with null positions. `buildBinaryTracks` is a pure transform from the track map to deck.gl binary format.

- [ ] **Create `src/api/opensky.js`**

```js
import { OPENSKY_URL } from '../config/sources.js'

/**
 * Fetches current aircraft state vectors from OpenSky Network (anonymous tier).
 * Filters out aircraft with null lat/lon.
 * Returns an array of normalized aircraft objects.
 * Throws on network error or non-2xx HTTP status.
 *
 * @returns {Promise<Array<{icao24, callsign, lon, lat, velocity, heading}>>}
 */
export async function fetchOpenSky() {
  const response = await fetch(OPENSKY_URL)
  if (!response.ok) {
    throw new Error(`OpenSky fetch failed: ${response.status} ${response.statusText}`)
  }
  const json = await response.json()
  if (!Array.isArray(json.states)) return []
  return json.states
    .filter((s) => s[5] != null && s[6] != null)
    .map((s) => ({
      icao24: s[0],
      callsign: s[1]?.trim() || null,
      lon: s[5],
      lat: s[6],
      velocity: s[9],
      heading: s[10],
    }))
}

/**
 * Transforms a Map<icao24, [lng, lat][]> into deck.gl binary PathLayer format.
 * Paths with fewer than 2 points are excluded (PathLayer requires at least 2 vertices).
 *
 * @param {Map<string, Array<[number, number]>>} trackMap
 * @returns {{ length: number, startIndices: Uint32Array, attributes: { getPath: { value: Float32Array, size: 2 } } }}
 */
export function buildBinaryTracks(trackMap) {
  const paths = []
  for (const track of trackMap.values()) {
    if (track.length >= 2) paths.push(track)
  }

  const totalVertices = paths.reduce((sum, p) => sum + p.length, 0)
  const positions = new Float32Array(totalVertices * 2)
  const startIndices = new Uint32Array(paths.length + 1)

  let vertexOffset = 0
  for (let i = 0; i < paths.length; i++) {
    startIndices[i] = vertexOffset
    for (const [lng, lat] of paths[i]) {
      positions[vertexOffset * 2] = lng
      positions[vertexOffset * 2 + 1] = lat
      vertexOffset++
    }
  }
  startIndices[paths.length] = vertexOffset

  return {
    length: paths.length,
    startIndices,
    attributes: {
      getPath: { value: positions, size: 2 },
    },
  }
}
```

- [ ] **Run the tests to confirm they pass**

```bash
npx vitest run src/api/opensky.test.js
```

Expected: all 5 tests pass.

---

## Chunk 2: Layers

### Task 4: Add failing tests for the adsb branch in `src/layers/index.test.js`

**Files:**
- Modify: `src/layers/index.test.js`

Add a `PathLayer` mock alongside the existing `ScatterplotLayer` mock. Add a new `describe('adsb branch')` block with 4 tests. The new tests will fail because `layers/index.js` does not yet import or use `PathLayer`.

- [ ] **Replace `src/layers/index.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
  PathLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
}))

import { buildLayers } from './index.js'

const mockVessel = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [25.0, 60.2] },
  properties: { mmsi: 123456789, sog: 5.2, cog: 180, navStat: 0, heading: 180 },
}

const mockBinaryTracks = {
  length: 1,
  startIndices: new Uint32Array([0, 2]),
  attributes: { getPath: { value: new Float32Array([10, 20, 11, 21]), size: 2 } },
}

const mockPosition = { icao24: 'abc123', callsign: 'UAL123', lon: 10, lat: 20, velocity: 200, heading: 90 }

describe('buildLayers — ais branch', () => {
  it('returns an array', () => {
    const layers = buildLayers({ points: true, adsb: false }, { points: [mockVessel], adsbTracks: mockBinaryTracks, adsbPositions: [] }, vi.fn())
    expect(Array.isArray(layers)).toBe(true)
  })

  it('includes ais-vessels layer when points is visible', () => {
    const layers = buildLayers({ points: true, adsb: false }, { points: [mockVessel], adsbTracks: mockBinaryTracks, adsbPositions: [] }, vi.fn())
    expect(layers.map((l) => l.id)).toContain('ais-vessels')
  })

  it('omits ais-vessels layer when points is not visible', () => {
    const layers = buildLayers({ points: false, adsb: false }, { points: [mockVessel], adsbTracks: mockBinaryTracks, adsbPositions: [] }, vi.fn())
    expect(layers).toHaveLength(0)
  })

  it('calls onFeatureClick with the clicked vessel feature', () => {
    const handler = vi.fn()
    const layers = buildLayers({ points: true, adsb: false }, { points: [mockVessel], adsbTracks: mockBinaryTracks, adsbPositions: [] }, handler)
    const layer = layers.find((l) => l.id === 'ais-vessels')
    layer.props.onClick({ object: mockVessel })
    expect(handler).toHaveBeenCalledWith(mockVessel)
  })

  it('does not call onFeatureClick when vessel object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers({ points: true, adsb: false }, { points: [mockVessel], adsbTracks: mockBinaryTracks, adsbPositions: [] }, handler)
    const layer = layers.find((l) => l.id === 'ais-vessels')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('buildLayers — adsb branch', () => {
  it('includes adsb-tracks and adsb-positions when adsb is visible', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).toContain('adsb-tracks')
    expect(ids).toContain('adsb-positions')
  })

  it('omits adsb layers when adsb is false', () => {
    const layers = buildLayers(
      { points: false, adsb: false },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).not.toContain('adsb-tracks')
    expect(ids).not.toContain('adsb-positions')
  })

  it('wraps adsb-positions click object in a properties envelope for FeaturePopup', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      handler
    )
    const layer = layers.find((l) => l.id === 'adsb-positions')
    layer.props.onClick({ object: mockPosition })
    expect(handler).toHaveBeenCalledWith({ properties: mockPosition })
  })

  it('does not call onFeatureClick when adsb position object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [] },
      handler
    )
    const layer = layers.find((l) => l.id === 'adsb-positions')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Run the tests to confirm the new adsb tests fail**

```bash
npx vitest run src/layers/index.test.js
```

Expected: the 5 existing AIS tests still pass; the 4 new ADSB tests fail because `PathLayer` is not yet used in `index.js`.

---

### Task 5: Update `src/layers/index.js`

**Files:**
- Modify: `src/layers/index.js`

Import `PathLayer`. Add the `adsb` branch with a PathLayer (binary trails) and a ScatterplotLayer (current positions). The ADS-B click handler wraps the position object in `{ properties: object }` so `FeaturePopup` can render it without modification.

- [ ] **Replace `src/layers/index.js`**

```js
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool, adsb: bool }
 * @param {Object} data - { points: Array<GeoJSONFeature>, adsbTracks: BinaryPathData, adsbPositions: Array<AircraftPosition> }
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
      new ScatterplotLayer({
        id: 'adsb-positions',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 4,
        radiusUnits: 'pixels',
        getFillColor: [0, 220, 255, 220],
        pickable: true,
        // Wrap in { properties } so FeaturePopup renders key/value pairs correctly
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      })
    )
  }

  return layers
}
```

- [ ] **Run the layer tests to confirm all 9 tests pass**

```bash
npx vitest run src/layers/index.test.js
```

Expected: all 9 tests pass (5 AIS + 4 ADSB).

---

## Chunk 3: Hook and UI wiring

### Task 6: Create `src/hooks/useADSB.js`

**Files:**
- Create: `src/hooks/useADSB.js`

The hook polls OpenSky every `OPENSKY_POLL_INTERVAL` ms, accumulates `[lon, lat]` positions per ICAO24 in a Map ref with a rolling window of `OPENSKY_MAX_TRACK_POINTS`, and flushes binary tracks and current positions to React state every `OPENSKY_FLUSH_INTERVAL` ms. Two separate intervals keep polling and rendering concerns independent.

- [ ] **Create `src/hooks/useADSB.js`**

```js
import { useState, useEffect, useRef } from 'react'
import { fetchOpenSky, buildBinaryTracks } from '../api/opensky.js'
import {
  OPENSKY_POLL_INTERVAL,
  OPENSKY_FLUSH_INTERVAL,
  OPENSKY_MAX_TRACK_POINTS,
} from '../config/sources.js'

const EMPTY_BINARY = buildBinaryTracks(new Map())

/**
 * Connects to OpenSky Network and accumulates aircraft track history by ICAO24.
 * State is flushed to React on a fixed interval to decouple rendering from polling.
 *
 * Returns { binaryTracks, currentPositions, connected, error }
 *   binaryTracks     - deck.gl binary PathLayer format (Float32Array + Uint32Array)
 *   currentPositions - array of { icao24, callsign, lon, lat, velocity, heading }
 *   connected        - true after the first successful poll
 *   error            - Error if the last poll failed, null otherwise
 */
export function useADSB() {
  const [binaryTracks, setBinaryTracks] = useState(EMPTY_BINARY)
  const [currentPositions, setCurrentPositions] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  const trackMap = useRef(new Map())
  const latestPositions = useRef([])

  useEffect(() => {
    let destroyed = false

    async function poll() {
      try {
        const aircraft = await fetchOpenSky()
        if (destroyed) return
        setConnected(true)
        setError(null)
        latestPositions.current = aircraft
        for (const a of aircraft) {
          const track = trackMap.current.get(a.icao24) ?? []
          track.push([a.lon, a.lat])
          if (track.length > OPENSKY_MAX_TRACK_POINTS) track.shift()
          trackMap.current.set(a.icao24, track)
        }
      } catch (err) {
        if (!destroyed) setError(err)
      }
    }

    poll()
    const pollId = setInterval(poll, OPENSKY_POLL_INTERVAL)

    const flushId = setInterval(() => {
      if (destroyed) return
      setBinaryTracks(buildBinaryTracks(trackMap.current))
      setCurrentPositions([...latestPositions.current])
    }, OPENSKY_FLUSH_INTERVAL)

    return () => {
      destroyed = true
      clearInterval(pollId)
      clearInterval(flushId)
    }
  }, [])

  return { binaryTracks, currentPositions, connected, error }
}
```

---

### Task 7: Update `src/store/mapStore.js`

**Files:**
- Modify: `src/store/mapStore.js`

Add `adsb: true` to the initial `layerVisibility`.

- [ ] **Edit the `layerVisibility` initial state**

```js
// Before:
layerVisibility: {
  points: true,
},

// After:
layerVisibility: {
  points: true,
  adsb: true,
},
```

- [ ] **Run the store tests to confirm they still pass**

```bash
npx vitest run src/store/mapStore.test.js
```

Expected: all 4 tests pass. The `setLayerVisibility` test uses the `points` key and is unaffected.

---

### Task 8: Update `src/App.jsx`

**Files:**
- Modify: `src/App.jsx`

Import `useADSB` and add `adsbTracks` and `adsbPositions` to `layerData`.

- [ ] **Add the import at the top of `src/App.jsx`**

```js
import { useADSB } from './hooks/useADSB.js'
```

- [ ] **Add the hook call inside `App` (after the `useAIS` call)**

```js
const { binaryTracks, currentPositions } = useADSB()
```

- [ ] **Extend the `layerData` object**

```js
// Before:
const layerData = {
  points: vessels,
}

// After:
const layerData = {
  points: vessels,
  adsbTracks: binaryTracks,
  adsbPositions: currentPositions,
}
```

---

### Task 9: Update `src/components/LayerPanel.jsx`

**Files:**
- Modify: `src/components/LayerPanel.jsx`

Add the ADS-B color entry to `LAYER_COLORS`. `LayerPanel` already drives its list from `Object.values(LAYERS)`, so no structural changes are needed.

- [ ] **Edit the `LAYER_COLORS` map**

```js
// Before:
const LAYER_COLORS = {
  points: 'var(--amber)',
}

// After:
const LAYER_COLORS = {
  points: 'var(--amber)',
  adsb: 'var(--blue)',
}
```

---

## Chunk 4: Verification

### Task 10: Run the full test suite and verify in the browser

**Files:** (none)

- [ ] **Run all tests**

```bash
npx vitest run
```

Expected: all tests pass — `opensky.test.js` (5), `layers/index.test.js` (9), `store/mapStore.test.js` (4), `components/LayerPanel.test.jsx` (3), `components/FeaturePopup.test.jsx` (3). Zero failures.

- [ ] **Start the dev server**

```bash
npm run dev
```

- [ ] **Verify in the browser**

Open the app and check:

1. The LayerPanel shows two rows: "AIS VESSELS" and "ADS-B AIRCRAFT" with ON/OFF toggles (ACTIVE 2/2)
2. Amber dots (AIS vessels) appear on the map
3. After the first 10-second poll, cyan/blue dots (ADS-B positions) appear globally
4. After 2-3 polls, short cyan line segments (track trails) appear connecting aircraft positions
5. Toggling the ADS-B checkbox in the LayerPanel hides/shows both the tracks and dots together
6. Clicking an ADS-B dot opens FeaturePopup showing ICAO24, CALLSIGN, LON, LAT, VELOCITY, HEADING
7. Clicking an AIS dot still works as before (MMSI, SOG, COG, etc.)
8. No console errors