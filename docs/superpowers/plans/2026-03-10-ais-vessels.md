# AIS Vessels Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken GeoServer placeholder with a live AIS vessel feed from digitraffic.fi, rendered as a ScatterplotLayer via the WebGPU backend.

**Architecture:** A thin fetch wrapper (`ais.js`) calls the digitraffic.fi REST endpoint. A polling hook (`useAIS.js`) calls it on mount and every 30 seconds, retaining the last successful result on failure. App.jsx wires the vessels array into the existing `layerData.points` slot so MapView and GPUInfoPanel require no changes.

**Tech Stack:** React 19, deck.gl 9.2, luma.gl WebGPU, Zustand, Vitest

---

## Chunk 1: Config and API fetch

### Task 1: Update `src/config/sources.js`

**Files:**
- Modify: `src/config/sources.js`

Remove the GeoServer `LAYERS` export. Add `AIS_URL`, `AIS_POLL_INTERVAL`, and a new `LAYERS` object with a single AIS entry. Update `DEFAULT_VIEW` coordinates to Finnish coastal waters (where this API has coverage) and fix the zoom value so the existing `mapStore.test.js` assertion passes.

- [ ] **Replace the contents of `src/config/sources.js`**

```js
// AIS data — Finnish Maritime Authority. Free, no auth, CORS-enabled.
export const AIS_URL = 'https://meri.digitraffic.fi/api/vessel-location/v1/locations'
export const AIS_POLL_INTERVAL = 30_000

export const LAYERS = {
  AIS: {
    id: 'points',
    label: 'AIS Vessels',
  },
}

// Free dark vector basemap — no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center — Finnish coastal waters
export const DEFAULT_VIEW = {
  longitude: 25.0,
  latitude: 60.2,
  zoom: 6,
}
```

- [ ] **Fix the pre-existing broken zoom assertion in `src/store/mapStore.test.js`**

This test is already broken before any changes: `mapStore.test.js` expects `zoom: 4` but `DEFAULT_VIEW.zoom` is already `6` in the current `sources.js`. Task 1 does not change the zoom value — it just needs the test to reflect reality:

```js
// Before:
expect(viewport.zoom).toBe(4)
// After:
expect(viewport.zoom).toBe(6)
```

- [ ] **Remove the orphaned `polygons` key from `src/store/mapStore.js`**

The store's initial `layerVisibility` has `polygons: true` but there is no longer a polygons layer. Remove it:

```js
// Before:
layerVisibility: {
  points: true,
  polygons: true,
},

// After:
layerVisibility: {
  points: true,
},
```

- [ ] **Run the store tests to confirm they pass**

```bash
npx vitest run src/store/mapStore.test.js
```

Expected: all 4 tests pass.

---

### Task 2: Create `src/api/ais.js`

**Files:**
- Create: `src/api/ais.js`

This module has one job: fetch the digitraffic.fi endpoint, validate the response, filter features with null geometry, and return the features array. All error propagation is left to the caller.

- [ ] **Create `src/api/ais.js`**

```js
import { AIS_URL } from '../config/sources.js'

/**
 * Fetches AIS vessel positions from digitraffic.fi.
 * Returns the GeoJSON features array with null-geometry entries removed.
 * Throws on network error, non-2xx HTTP status, or JSON parse failure.
 */
export async function fetchAISVessels() {
  const response = await fetch(AIS_URL)
  if (!response.ok) {
    throw new Error(`AIS fetch failed: ${response.status} ${response.statusText}`)
  }
  const json = await response.json()
  if (!Array.isArray(json.features)) {
    throw new Error('AIS response missing features array')
  }
  return json.features.filter((f) => f.geometry != null)
}
```

No automated test for this module (per spec). Verify manually in the browser after Task 5 wires the hook in.

---

## Chunk 2: Layers (TDD)

### Task 3: Rewrite `src/layers/index.test.js`

**Files:**
- Modify: `src/layers/index.test.js`

Write the new tests first. They will fail because `layers/index.js` still has the old GeoJsonLayer code. Confirm they fail before proceeding to Task 4.

- [ ] **Replace `src/layers/index.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
}))

import { buildLayers } from './index.js'

const mockVessel = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [25.0, 60.2] },
  properties: { mmsi: 123456789, sog: 5.2, cog: 180, navStat: 0, heading: 180 },
}

describe('buildLayers', () => {
  it('returns an array', () => {
    const layers = buildLayers({ points: true }, { points: [mockVessel] }, vi.fn())
    expect(Array.isArray(layers)).toBe(true)
  })

  it('includes ais-vessels layer when points is visible', () => {
    const layers = buildLayers({ points: true }, { points: [mockVessel] }, vi.fn())
    expect(layers.map((l) => l.id)).toContain('ais-vessels')
  })

  it('omits ais-vessels layer when points is not visible', () => {
    const layers = buildLayers({ points: false }, { points: [mockVessel] }, vi.fn())
    expect(layers).toHaveLength(0)
  })

  it('calls onFeatureClick with the clicked vessel feature', () => {
    const handler = vi.fn()
    const layers = buildLayers({ points: true }, { points: [mockVessel] }, handler)
    const layer = layers.find((l) => l.id === 'ais-vessels')
    layer.props.onClick({ object: mockVessel })
    expect(handler).toHaveBeenCalledWith(mockVessel)
  })

  it('does not call onFeatureClick when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers({ points: true }, { points: [mockVessel] }, handler)
    const layer = layers.find((l) => l.id === 'ais-vessels')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Run the new tests to confirm they fail**

```bash
npx vitest run src/layers/index.test.js
```

Expected: failures. The layer id in the current `index.js` is `'points'`; the tests expect `'ais-vessels'`.

---

### Task 4: Update `src/layers/index.js`

**Files:**
- Modify: `src/layers/index.js`

Remove the `GeoJsonLayer` import and the `layerVisibility.polygons` branch. Rename the layer id to `'ais-vessels'`. Keep the same `buildLayers` signature.

- [ ] **Replace `src/layers/index.js`**

```js
import { ScatterplotLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool }
 * @param {Object} data - { points: Array<GeoJSONFeature> }
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

  return layers
}
```

- [ ] **Run the layer tests to confirm they pass**

```bash
npx vitest run src/layers/index.test.js
```

Expected: all 5 tests pass.

---

## Chunk 3: Hook and UI wiring

### Task 5: Create `src/hooks/useAIS.js`

**Files:**
- Create: `src/hooks/useAIS.js`

The hook fetches on mount, polls every `AIS_POLL_INTERVAL` milliseconds, retains the last successful result on failure, and cleans up the interval on unmount.

- [ ] **Create `src/hooks/useAIS.js`**

```js
import { useState, useEffect, useRef } from 'react'
import { fetchAISVessels } from '../api/ais.js'
import { AIS_POLL_INTERVAL } from '../config/sources.js'

export function useAIS() {
  const [vessels, setVessels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const lastVessels = useRef([])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      setError(null)
      try {
        const features = await fetchAISVessels()
        if (!cancelled) {
          lastVessels.current = features
          setVessels(features)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err)
          setVessels(lastVessels.current)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const id = setInterval(poll, AIS_POLL_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return { vessels, loading, error }
}
```

---

### Task 6: Update `src/App.jsx`

**Files:**
- Modify: `src/App.jsx`

Replace the two `useLayerData` calls and the `LAYERS` import with a single `useAIS` call. Remove the `polygons` key from `layerData`.

- [ ] **Replace `src/App.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useAIS } from './hooks/useAIS.js'

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

  const { vessels } = useAIS()

  const layerData = {
    points: vessels,
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

### Task 7: Update `src/components/LayerPanel.jsx`

**Files:**
- Modify: `src/components/LayerPanel.jsx`

Remove the `polygons` entry from `LAYER_COLORS`. Fix the `activeCount` calculation to count only layers defined in `LAYERS` (not orphaned keys in the Zustand store).

- [ ] **Replace `src/components/LayerPanel.jsx`**

```jsx
import { LAYERS } from '../config/sources.js'

const LAYER_COLORS = {
  points: 'var(--amber)',
}

export function LayerPanel({ visibility, onToggle }) {
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

      <div className="panel-footer">
        <span className="footer-stat">
          ACTIVE&nbsp;{activeCount}/{totalCount}
        </span>
      </div>
    </aside>
  )
}
```

---

## Chunk 4: Cleanup and verification

### Task 8: Delete GeoServer files

**Files:**
- Delete: `src/api/geoserver.js`
- Delete: `src/hooks/useLayerData.js`
- Delete: `src/api/geoserver.test.js`
- Delete: `src/hooks/useLayerData.test.js`

- [ ] **Delete the four GeoServer files**

Run from the project root (`/home/bradstricherz/WebstormProjects/webgputest`):

```bash
rm src/api/geoserver.js \
   src/hooks/useLayerData.js \
   src/api/geoserver.test.js \
   src/hooks/useLayerData.test.js
```

---

### Task 9: Run full test suite and verify

- [ ] **Run all tests**

```bash
npx vitest run
```

Expected output: all tests in `src/layers/index.test.js`, `src/store/mapStore.test.js`, and any remaining test files pass. Zero failures.

- [ ] **Start the dev server and verify in the browser**

```bash
npm run dev
```

Open the app. Check:
1. The map centers on Finnish coastal waters (~60°N, 25°E)
2. Amber dots appear on the map representing AIS vessels
3. The LayerPanel shows "AIS VESSELS" with ON/OFF toggle (ACTIVE 1/1)
4. The GPUInfoPanel shows a non-zero active point count
5. Clicking a vessel opens the FeaturePopup showing `mmsi`, `sog`, `cog`, `navStat`, `heading`
6. After 30 seconds, the point count updates (may stay the same if no position changes)
7. No console errors about GeoServer connection refused