# WebGPU WebGIS MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a WebGPU-accelerated WebGIS frontend with a MapLibre basemap, deck.gl layers, GeoServer data sources, and Zustand state management.

**Architecture:** MapLibre GL JS renders the vector basemap on WebGL2; deck.gl 9.x composites its WebGPU canvas on top via `MapboxOverlay` from `@deck.gl/mapbox`. Zustand holds viewport, layer visibility, and selected feature state. Axios fetches WFS GeoJSON from GeoServer; loaders.gl parses responses.

**Tech Stack:** React 19, Vite 8, MapLibre GL JS, react-map-gl, deck.gl 9.x, @luma.gl/webgpu, @loaders.gl/core + json, Zustand, Axios, Vitest + Testing Library

---

## Task 1: Install dependencies and configure Vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `src/setupTests.js`

**Step 1: Install production dependencies**

```bash
npm install maplibre-gl react-map-gl deck.gl @deck.gl/react @deck.gl/mapbox @luma.gl/webgpu @loaders.gl/core @loaders.gl/json zustand axios
```

**Step 2: Install dev dependencies**

```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

**Step 3: Add test config to vite.config.js**

Replace the entire file:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})
```

**Step 4: Create src/setupTests.js**

```js
import '@testing-library/jest-dom'
```

**Step 5: Add test script to package.json**

Add to the `scripts` section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 6: Verify Vitest works**

```bash
npm test
```

Expected: "No test files found" — that's fine, no tests yet.

---

## Task 2: Zustand store

**Files:**
- Create: `src/store/mapStore.js`
- Create: `src/store/mapStore.test.js`

**Step 1: Write the failing test**

Create `src/store/mapStore.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from './mapStore'
import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

describe('mapStore', () => {
  beforeEach(() => {
    useMapStore.setState(useMapStore.getInitialState())
  })

  it('has default viewport', () => {
    const { viewport } = useMapStore.getState()
    expect(viewport.zoom).toBe(4)
    expect(typeof viewport.longitude).toBe('number')
    expect(typeof viewport.latitude).toBe('number')
  })

  it('setViewport updates viewport', () => {
    const { setViewport } = useMapStore.getState()
    act(() => setViewport({ longitude: 10, latitude: 20, zoom: 8, pitch: 0, bearing: 0 }))
    expect(useMapStore.getState().viewport.zoom).toBe(8)
  })

  it('setLayerVisibility toggles a layer', () => {
    const { setLayerVisibility } = useMapStore.getState()
    act(() => setLayerVisibility('points', false))
    expect(useMapStore.getState().layerVisibility.points).toBe(false)
  })

  it('setSelectedFeature stores feature', () => {
    const { setSelectedFeature } = useMapStore.getState()
    const feature = { id: '1', properties: { name: 'Test' } }
    act(() => setSelectedFeature(feature))
    expect(useMapStore.getState().selectedFeature).toEqual(feature)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './mapStore'"

**Step 3: Create src/store/mapStore.js**

```js
import { create } from 'zustand'

const initialState = {
  viewport: {
    longitude: -98.5795,
    latitude: 39.8283,
    zoom: 4,
    pitch: 0,
    bearing: 0,
  },
  layerVisibility: {
    points: true,
    polygons: true,
  },
  selectedFeature: null,
}

export const useMapStore = create((set) => ({
  ...initialState,
  setViewport: (viewport) => set({ viewport }),
  setLayerVisibility: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),
  setSelectedFeature: (feature) => set({ selectedFeature: feature }),
}))

useMapStore.getInitialState = () => ({
  ...initialState,
  setViewport: useMapStore.getState().setViewport,
  setLayerVisibility: useMapStore.getState().setLayerVisibility,
  setSelectedFeature: useMapStore.getState().setSelectedFeature,
})
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS (4 tests)

---

## Task 3: GeoServer Axios client

**Files:**
- Create: `src/api/geoserver.js`
- Create: `src/api/geoserver.test.js`

**Step 1: Write the failing test**

Create `src/api/geoserver.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { baseURL: '' },
  }
  return { default: { create: vi.fn(() => instance), ...instance } }
})

describe('geoserver client', () => {
  it('creates axios instance with correct baseURL', async () => {
    const { geoserverClient } = await import('./geoserver.js')
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: expect.stringContaining('/geoserver') })
    )
  })

  it('buildWfsUrl returns correct WFS GetFeature URL params', async () => {
    const { buildWfsUrl } = await import('./geoserver.js')
    const url = buildWfsUrl('myWorkspace:myLayer')
    expect(url).toContain('service=WFS')
    expect(url).toContain('request=GetFeature')
    expect(url).toContain('outputFormat=application/json')
    expect(url).toContain('typeName=myWorkspace:myLayer')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './geoserver.js'"

**Step 3: Create src/api/geoserver.js**

```js
import axios from 'axios'

// Update GEOSERVER_BASE_URL to match your GeoServer instance.
const GEOSERVER_BASE_URL = import.meta.env.VITE_GEOSERVER_URL ?? 'http://localhost:8080/geoserver'

export const geoserverClient = axios.create({
  baseURL: GEOSERVER_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Auth interceptor slot — fill in when needed (Basic Auth or Bearer token).
geoserverClient.interceptors.request.use((config) => {
  // const token = getAuthToken()
  // if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * Builds a WFS GetFeature query string for the given type name.
 * @param {string} typeName - e.g. 'myWorkspace:myLayer'
 * @param {string} [cqlFilter] - optional CQL filter string
 */
export function buildWfsUrl(typeName, cqlFilter) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName,
    outputFormat: 'application/json',
  })
  if (cqlFilter) params.set('CQL_FILTER', cqlFilter)
  return `?${params.toString()}`
}

/**
 * Fetches a WFS layer as GeoJSON FeatureCollection.
 * @param {string} typeName
 * @param {string} [cqlFilter]
 */
export async function fetchWfsLayer(typeName, cqlFilter) {
  const url = buildWfsUrl(typeName, cqlFilter)
  const response = await geoserverClient.get(url)
  return response.data
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

---

## Task 4: Source configuration

**Files:**
- Create: `src/config/sources.js`

No unit test needed — this is a constants file. Correctness is validated by the app running.

**Step 1: Create src/config/sources.js**

```js
// GeoServer layer type names — update to match your workspace and layer names.
export const LAYERS = {
  POINTS: {
    id: 'points',
    typeName: 'myWorkspace:myPoints',
    label: 'Points',
  },
  POLYGONS: {
    id: 'polygons',
    typeName: 'myWorkspace:myPolygons',
    label: 'Polygons',
  },
}

// Free vector basemap — no API key required.
// Swap for your GeoServer WMTS URL when ready.
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

// Default map center and zoom
export const DEFAULT_VIEW = {
  longitude: -98.5795,
  latitude: 39.8283,
  zoom: 4,
}
```

---

## Task 5: Layer builder

**Files:**
- Create: `src/layers/index.js`
- Create: `src/layers/index.test.js`

**Step 1: Write the failing test**

Create `src/layers/index.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildLayers } from './index.js'

const mockData = {
  points: [{ position: [-98, 39], properties: { name: 'A' } }],
  polygons: { type: 'FeatureCollection', features: [] },
}

describe('buildLayers', () => {
  it('returns array of layers', () => {
    const layers = buildLayers({ points: true, polygons: true }, mockData, vi.fn())
    expect(Array.isArray(layers)).toBe(true)
  })

  it('omits layers that are not visible', () => {
    const layers = buildLayers({ points: false, polygons: true }, mockData, vi.fn())
    const ids = layers.map((l) => l.id)
    expect(ids).not.toContain('points')
  })

  it('includes visible layers', () => {
    const layers = buildLayers({ points: true, polygons: false }, mockData, vi.fn())
    const ids = layers.map((l) => l.id)
    expect(ids).toContain('points')
  })

  it('calls onFeatureClick when onClick fires', () => {
    const handler = vi.fn()
    const layers = buildLayers({ points: true, polygons: false }, mockData, handler)
    const pointLayer = layers.find((l) => l.id === 'points')
    pointLayer.props.onClick({ object: mockData.points[0] })
    expect(handler).toHaveBeenCalledWith(mockData.points[0])
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './index.js'"

**Step 3: Create src/layers/index.js**

```js
import { ScatterplotLayer } from '@deck.gl/layers'
import { GeoJsonLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool, polygons: bool }
 * @param {Object} data - { points: Array, polygons: GeoJSON }
 * @param {Function} onFeatureClick - called with the clicked feature object
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.points) {
    layers.push(
      new ScatterplotLayer({
        id: 'points',
        data: data.points ?? [],
        getPosition: (d) => d.position,
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: [255, 80, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  if (layerVisibility.polygons) {
    layers.push(
      new GeoJsonLayer({
        id: 'polygons',
        data: data.polygons ?? { type: 'FeatureCollection', features: [] },
        filled: true,
        stroked: true,
        getFillColor: [0, 100, 200, 80],
        getLineColor: [0, 60, 140],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  return layers
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

---

## Task 6: useLayerData hook

**Files:**
- Create: `src/hooks/useLayerData.js`
- Create: `src/hooks/useLayerData.test.js`

**Step 1: Write the failing test**

Create `src/hooks/useLayerData.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../api/geoserver.js', () => ({
  fetchWfsLayer: vi.fn(),
}))

import { fetchWfsLayer } from '../api/geoserver.js'
import { useLayerData } from './useLayerData.js'

const mockGeoJson = { type: 'FeatureCollection', features: [{ id: '1' }] }

describe('useLayerData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns loading true initially', () => {
    fetchWfsLayer.mockResolvedValue(mockGeoJson)
    const { result } = renderHook(() => useLayerData('ws:layer'))
    expect(result.current.loading).toBe(true)
  })

  it('returns data after fetch resolves', async () => {
    fetchWfsLayer.mockResolvedValue(mockGeoJson)
    const { result } = renderHook(() => useLayerData('ws:layer'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(mockGeoJson)
    expect(result.current.error).toBeNull()
  })

  it('returns error if fetch rejects', async () => {
    fetchWfsLayer.mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useLayerData('ws:layer'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './useLayerData.js'"

**Step 3: Create src/hooks/useLayerData.js**

```js
import { useState, useEffect } from 'react'
import { fetchWfsLayer } from '../api/geoserver.js'

/**
 * Fetches a WFS layer from GeoServer and returns { data, loading, error }.
 * Re-fetches when typeName or cqlFilter changes.
 * @param {string} typeName - e.g. 'myWorkspace:myLayer'
 * @param {string} [cqlFilter] - optional CQL filter
 */
export function useLayerData(typeName, cqlFilter) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchWfsLayer(typeName, cqlFilter)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [typeName, cqlFilter])

  return { data, loading, error }
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

---

## Task 7: FeaturePopup component

**Files:**
- Create: `src/components/FeaturePopup.jsx`
- Create: `src/components/FeaturePopup.test.jsx`

**Step 1: Write the failing test**

Create `src/components/FeaturePopup.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeaturePopup } from './FeaturePopup.jsx'

const feature = {
  properties: { name: 'Test Site', status: 'active' },
}

describe('FeaturePopup', () => {
  it('renders nothing when feature is null', () => {
    const { container } = render(<FeaturePopup feature={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders feature properties', () => {
    render(<FeaturePopup feature={feature} onClose={vi.fn()} />)
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('Test Site')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<FeaturePopup feature={feature} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './FeaturePopup.jsx'"

**Step 3: Create src/components/FeaturePopup.jsx**

```jsx
export function FeaturePopup({ feature, onClose }) {
  if (!feature) return null

  return (
    <div style={{
      position: 'absolute',
      bottom: 32,
      left: 16,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: 4,
      padding: '12px 16px',
      minWidth: 220,
      zIndex: 10,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}>
      <button
        aria-label="close"
        onClick={onClose}
        style={{ float: 'right', cursor: 'pointer', background: 'none', border: 'none', fontSize: 16 }}
      >
        x
      </button>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {Object.entries(feature.properties ?? {}).map(([key, value]) => (
            <tr key={key}>
              <td style={{ fontWeight: 600, paddingRight: 8, paddingBottom: 4 }}>{key}</td>
              <td style={{ paddingBottom: 4 }}>{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

---

## Task 8: LayerPanel component

**Files:**
- Create: `src/components/LayerPanel.jsx`
- Create: `src/components/LayerPanel.test.jsx`

**Step 1: Write the failing test**

Create `src/components/LayerPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerPanel } from './LayerPanel.jsx'
import { LAYERS } from '../config/sources.js'

const visibility = { points: true, polygons: false }

describe('LayerPanel', () => {
  it('renders a toggle for each layer', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    Object.values(LAYERS).forEach(({ label }) => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  it('reflects current visibility state', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const pointsCheckbox = screen.getByRole('checkbox', { name: LAYERS.POINTS.label })
    const polygonsCheckbox = screen.getByRole('checkbox', { name: LAYERS.POLYGONS.label })
    expect(pointsCheckbox.checked).toBe(true)
    expect(polygonsCheckbox.checked).toBe(false)
  })

  it('calls onToggle with layer id and new value', () => {
    const onToggle = vi.fn()
    render(<LayerPanel visibility={visibility} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('checkbox', { name: LAYERS.POINTS.label }))
    expect(onToggle).toHaveBeenCalledWith('points', false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — "Cannot find module './LayerPanel.jsx'"

**Step 3: Create src/components/LayerPanel.jsx**

```jsx
import { LAYERS } from '../config/sources.js'

export function LayerPanel({ visibility, onToggle }) {
  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: 4,
      padding: '12px 16px',
      zIndex: 10,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      minWidth: 140,
    }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Layers</strong>
      {Object.values(LAYERS).map(({ id, label }) => (
        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={visibility[id] ?? true}
            onChange={(e) => onToggle(id, e.target.checked)}
            aria-label={label}
          />
          {label}
        </label>
      ))}
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

---

## Task 9: MapView component

**Files:**
- Create: `src/components/MapView.jsx`

No automated test — deck.gl and MapLibre require a real browser canvas. Manual verification via dev server.

**Step 1: Create src/components/MapView.jsx**

```jsx
import { useRef, useCallback } from 'react'
import Map from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

// Import the WebGPU device adapter — side-effect registers it with luma.gl.
import '@luma.gl/webgpu'

import { buildLayers } from '../layers/index.js'
import { useMapStore } from '../store/mapStore.js'
import { BASEMAP_STYLE } from '../config/sources.js'

function DeckGLOverlay({ layers }) {
  const overlay = useControl(
    () => new MapboxOverlay({ interleaved: false, device: 'webgpu', layers }),
    { position: 'top-left' }
  )
  overlay.setProps({ layers })
  return null
}

export function MapView({ layerData }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()

  const onFeatureClick = useCallback(
    (feature) => setSelectedFeature(feature),
    [setSelectedFeature]
  )

  const layers = buildLayers(layerVisibility, layerData, onFeatureClick)

  return (
    <Map
      {...viewport}
      style={{ width: '100%', height: '100%' }}
      mapStyle={BASEMAP_STYLE}
      onMove={(evt) => setViewport(evt.viewState)}
    >
      <DeckGLOverlay layers={layers} />
    </Map>
  )
}
```

> **Note:** `MapboxOverlay` passes `device: 'webgpu'` to the underlying Deck instance. If you see a luma.gl error about device type, confirm `@luma.gl/webgpu` is installed and the import side-effect runs before the overlay is created.

---

## Task 10: Wire up App.jsx

**Files:**
- Modify: `src/App.jsx`

**Step 1: Replace src/App.jsx**

```jsx
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useLayerData } from './hooks/useLayerData.js'
import { LAYERS } from './config/sources.js'

export default function App() {
  const { layerVisibility, setLayerVisibility, selectedFeature, setSelectedFeature } = useMapStore()

  const { data: pointsData } = useLayerData(LAYERS.POINTS.typeName)
  const { data: polygonsData } = useLayerData(LAYERS.POLYGONS.typeName)

  const layerData = {
    points: pointsData?.features ?? [],
    polygons: polygonsData ?? { type: 'FeatureCollection', features: [] },
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <MapView layerData={layerData} />
      <LayerPanel visibility={layerVisibility} onToggle={setLayerVisibility} />
      <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
    </div>
  )
}
```

**Step 2: Clear global styles from src/index.css**

Replace the contents of `src/index.css` with:

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  overflow: hidden;
}
```

**Step 3: Remove src/App.css import noise**

Delete `src/App.css` if it exists and remove any import of it (App.jsx no longer imports it).

---

## Task 11: Smoke test — run the dev server

**Step 1: Set VITE_GEOSERVER_URL (optional for local dev)**

Create a `.env.local` file:

```
VITE_GEOSERVER_URL=http://localhost:8080/geoserver
```

If GeoServer is not running yet, the WFS fetches will fail silently — the map will still render with an empty layer.

**Step 2: Start dev server**

```bash
npm run dev
```

**Step 3: Open Chrome (required — WebGPU only works in Chromium)**

Navigate to `http://localhost:5173`

**Expected result:**
- Full-screen map renders with the OpenFreeMap Positron basemap
- "Layers" panel visible top-right with Points and Polygons toggles
- No console errors about WebGPU device
- Toggling a layer hides/shows it

**Step 4: Verify WebGPU is active**

Open DevTools > Console and run:

```js
(await navigator.gpu.requestAdapter()).name
```

Expected: adapter name string (e.g. "ANGLE (NVIDIA...)")

**Step 5: Run full test suite one final time**

```bash
npm test
```

Expected: All tests PASS

---

## Environment Variables Reference

| Variable | Description | Example |
|---|---|---|
| `VITE_GEOSERVER_URL` | Base URL for GeoServer | `http://myserver:8080/geoserver` |

## Next Steps (post-MVP)

- Add auth interceptor in `src/api/geoserver.js`
- Replace `BASEMAP_STYLE` with your GeoServer WMTS URL in `src/config/sources.js`
- Update `LAYERS` type names in `src/config/sources.js` to match your workspace
- Add `MVTLayer` for streaming large polygon datasets
- Add time slider or CQL filter UI for operational use case