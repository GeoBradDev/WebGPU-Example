# Data Layer Redesign Spec

**Date:** 2026-03-11
**Project:** WebGPU Groundtruth
**Goal:** Replace broken AIS/ADS-B/satellite layers with three reliable, auth-free data sources that render 10,000-50,000 points to demonstrate WebGPU rendering performance.

---

## Problem

The existing data layers are all broken:

- **AIS** (aisstream.io WebSocket): connection fails, requires paid API key
- **ADS-B** (OpenSky Network REST): rate-limited for anonymous browser clients, CORS issues
- **Satellite** (Celestrak TLE via Vite proxy): proxy misconfiguration, never completed

## Solution

Replace all three with sources that work reliably in a browser without authentication:

| Layer | Source | Volume | Update |
|-------|--------|--------|--------|
| Satellites | Celestrak TLE (via Vite proxy) | ~23,000 objects | Every 10s (propagated) |
| Airports | OurAirports airports.csv (GitHub raw) | ~7,000 points | Once at startup |
| Sea Ports | World Port Index GeoJSON (static CDN) | ~3,500 points | Once at startup |

Total: ~33,500 points across three entity types.

---

## Architecture

No structural changes to the app shell. React + Vite + deck.gl + Zustand stays as-is.

### Data Sources

**Satellites**
- Fetch TLE data once at startup via Vite proxy: `/celestrak` proxied to `https://celestrak.org`
- Parse with satellite.js
- Propagate positions in a Web Worker (`src/workers/satelliteWorker.js`) every 10 seconds
- Worker receives `{ type: 'propagate', tles, time }`, responds with `Float32Array` of `[lon, lat, ...]`
- Main thread receives typed array, passes directly to deck.gl as binary columnar data

**Airports**
- Fetch: `https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv`
- No proxy needed (GitHub raw has permissive CORS headers)
- Parse CSV, filter to rows with valid lat/lon and type not `closed`
- Store as `Array<{ lon, lat, name, type }>`

**Sea Ports**
- Fetch World Port Index GeoJSON from a reliable static source
- Parse features to `Array<{ lon, lat, name }>`
- Store statically, no updates

### Hooks

Each source gets its own hook in `src/hooks/`:

- `useSatellites()` returns `{ satellites: { length: number, attributes: { getPosition: { value: Float32Array, size: 2 } } }, count: number, connected: boolean, error }`
- `useAirports()` returns `{ airports: Array<{ lon, lat, name, type }>, loaded: boolean, error }`
- `usePorts()` returns `{ ports: Array<{ lon, lat, name }>, loaded: boolean, error }`

`App.jsx` consumes all three and assembles `layerData`:

```js
const layerData = {
  satellites: satellites,   // binary columnar object from useSatellites
  airports: airports,       // plain array from useAirports
  ports: ports,             // plain array from usePorts
}
```

### Layers

`buildLayers(layerVisibility, data, onFeatureClick)` signature is unchanged. Three ScatterplotLayers replace the existing layers in `src/layers/index.js`:

| Layer ID | Label | Color (RGBA) | Radius | Pickable | Data shape |
|----------|-------|--------------|--------|----------|------------|
| `satellites` | Satellites | `[0, 220, 255, 180]` | 3px | No | Binary columnar |
| `airports` | Airports | `[255, 180, 0, 200]` | 5px | Yes | Plain array |
| `ports` | Sea Ports | `[0, 255, 140, 200]` | 5px | Yes | Plain array |

`layerVisibility` keys update to `{ satellites, airports, ports }`.

Satellites use binary columnar input. `useSatellites` returns `{ satellites, count, connected, error }` where `satellites` is `{ length: number, attributes: { getPosition: { value: Float32Array, size: 2 } } }`. App.jsx sets `layerData.satellites = satellites`, so `data.satellites` in `buildLayers` is that binary object:
```js
new ScatterplotLayer({
  id: 'satellites',
  data: data.satellites,           // { length, attributes: { getPosition: { value: Float32Array, size: 2 } } }
  getRadius: 3,
  radiusUnits: 'pixels',
  getFillColor: [0, 220, 255, 180],
  pickable: false,
})
```

Airports and ports use plain arrays:
```js
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
```

Pickable layers wrap the object in `{ properties: object }` so the existing `FeaturePopup` renders key/value pairs correctly without changes.

### Vite Proxy

`vite.config.js` currently has no `server` block. Add one:

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
})
```

The worker fetches `/celestrak/pub/TLE/catalog.txt` in dev. Production deployment requires a separate reverse proxy or serverless function - document in README.

### Config Constants

`src/config/sources.js` replaces all AIS/ADS-B constants with:

```js
export const CELESTRAK_TLE_URL = '/celestrak/pub/TLE/catalog.txt'
export const SATELLITE_PROPAGATE_INTERVAL = 10_000   // ms
export const OURAIRPORTS_CSV_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv'
export const WORLD_PORTS_URL = '/data/ports.geojson'  // bundled static asset (see File Changes)

export const LAYERS = {
  SATELLITES: { id: 'satellites', label: 'Satellites' },
  AIRPORTS:   { id: 'airports',   label: 'Airports' },
  PORTS:      { id: 'ports',      label: 'Sea Ports' },
}

export const DEFAULT_VIEW = {
  longitude: 0,
  latitude: 20,
  zoom: 2,
}

export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
```

---

## File Changes

| File | Action |
|------|--------|
| `vite.config.js` | Add Celestrak proxy (full config shown above) |
| `package.json` | Add `satellite.js` dependency via npm install |
| `public/data/ports.geojson` | New: bundle World Port Index GeoJSON as static asset (download from NGA WPI public domain dataset; GeoJSON FeatureCollection with Point features, each with `PORT_NAME` property) |
| `src/config/sources.js` | Replace all AIS/ADS-B constants with new constants (full spec above) |
| `src/workers/satelliteWorker.js` | New: TLE propagation Web Worker |
| `src/hooks/useSatellites.js` | New: replaces useADSB.js |
| `src/hooks/useAirports.js` | New: replaces useAIS.js |
| `src/hooks/usePorts.js` | New |
| `src/api/opensky.js` | Delete |
| `src/api/opensky.test.js` | Delete |
| `src/api/ais.js` | Delete |
| `src/hooks/useADSB.js` | Delete |
| `src/hooks/useAIS.js` | Delete |
| `src/layers/index.js` | Replace two layers with three (spec above) |
| `src/layers/index.test.js` | Rewrite tests for new layer signatures and data shapes |
| `src/App.jsx` | Swap hook imports; update layerData to `{ satellites, airports, ports }` |
| `src/store/mapStore.js` | Update `layerVisibility` initial state to `{ satellites: true, airports: true, ports: true }` |
| `src/store/mapStore.test.js` | Update tests for new visibility keys |
| `src/components/MapView.jsx` | Update `activePointCount` calculation (see below) |
| `src/components/LayerPanel.jsx` | Update `LAYER_COLORS` map (see below) |

---

## Component Updates

### MapView.jsx activePointCount

Replace the current `points`/`adsb` calculation with:

```js
const activePointCount =
  (layerVisibility.satellites ? (layerData.satellites?.length ?? 0) : 0) +
  (layerVisibility.airports   ? (layerData.airports?.length ?? 0)   : 0) +
  (layerVisibility.ports      ? (layerData.ports?.length ?? 0)      : 0)
```

`layerData.satellites` is the binary columnar object which has a `length` property (number of satellite objects) set by `useSatellites`.

### LayerPanel.jsx LAYER_COLORS

Replace the hardcoded `LAYER_COLORS` map with:

```js
const LAYER_COLORS = {
  satellites: 'var(--blue)',
  airports:   'var(--amber)',
  ports:      'var(--green)',
}
```

`--green` CSS variable should be added to `src/index.css` alongside the existing `--amber` and `--blue`: `--green: #00ff8c;`

---

## Error Handling

- All three fetches log errors to console and set an `error` state in their hook
- `LayerPanel` shows a subtle error indicator per layer if `error` is set (existing pattern)
- Satellite worker errors are caught and posted back as `{ type: 'error', message }`
- If Celestrak fetch fails, satellite layer shows empty with error state

---

## Out of Scope

- Production reverse proxy setup (documented, not implemented)
- WebGPU compute shaders (not needed at this scale)
- Historical playback or time scrubbing
- Authentication or user-specific data
