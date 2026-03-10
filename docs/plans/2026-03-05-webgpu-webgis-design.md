# WebGPU WebGIS MVP — Design Document

Date: 2026-03-05

## Overview

A WebGIS frontend MVP targeting internal Chromium-based users and a public-facing information portal. Renders a mix of point features, vector polygons/lines, and raster tiles. Spatial processing lives in PostGIS and GeoServer; the client fetches pre-processed data and renders it via WebGPU.

## Stack

| Concern | Library |
|---|---|
| Framework | React 19 + Vite |
| Basemap | MapLibre GL JS (WebGL2) |
| React map wrapper | react-map-gl |
| GPU layers | deck.gl 9.x (`@deck.gl/react`) with `device: 'webgpu'` |
| WebGPU adapter | `@luma.gl/webgpu` |
| Data loading | `@loaders.gl/core` + `@loaders.gl/json` |
| State management | Zustand |
| HTTP client | Axios |

## Architecture

MapLibre GL JS owns its WebGL2 canvas for the vector basemap. deck.gl composites its WebGPU canvas on top via `MapLibreOverlay` (CSS absolute positioning). The two render pipelines are independent — no shared GPU context.

```
App
├── MapView          — react-map-gl <Map> + <MapLibreOverlay> + deck.gl layers
├── LayerPanel       — sidebar layer visibility toggles
└── FeaturePopup     — feature properties on click
```

## File Structure

```
src/
├── components/
│   ├── MapView.jsx          — Map + MapLibreOverlay + deck.gl layers
│   ├── LayerPanel.jsx       — sidebar layer toggles
│   └── FeaturePopup.jsx     — click/hover popup
├── hooks/
│   └── useLayerData.js      — axios GET → loaders.gl parse → {data, loading, error}
├── layers/
│   └── index.js             — builds deck.gl layer array from visibility state
├── store/
│   └── mapStore.js          — Zustand store
├── api/
│   └── geoserver.js         — axios instance with baseURL + WFS helpers
├── config/
│   └── sources.js           — GeoServer endpoint URLs, layer names, style constants
├── App.jsx                  — root component, reads from store
└── main.jsx
```

## State (Zustand)

```js
// src/store/mapStore.js
{
  viewport: { longitude, latitude, zoom, pitch, bearing },
  layerVisibility: { points: true, polygons: true },
  selectedFeature: null,
  setViewport,
  setLayerVisibility,
  setSelectedFeature,
}
```

## Data Flow

| Purpose | Protocol | Consumer |
|---|---|---|
| Basemap tiles | WMS / WMTS | MapLibre raster or vector source |
| Point/polygon features | WFS (GeoJSON output format) | deck.gl layer `data` prop via axios |
| Streaming vector tiles | MVT (GeoServer vector tiles) | deck.gl `MVTLayer` |
| Spatial queries on click | WFS with CQL filter | axios → FeaturePopup |

Spatial filtering, aggregation, and joins stay in PostGIS/GeoServer. No client-side spatial math.

## GeoServer API Client

Axios instance in `api/geoserver.js` with:
- `baseURL` pointing at GeoServer instance
- Request interceptor slot for auth (Basic Auth or Bearer token)
- Helper functions for WFS GetFeature and GetFeatureInfo requests

## MVP Layer Set

- `ScatterplotLayer` or `IconLayer` — point features (assets, incidents, POIs)
- `GeoJsonLayer` — polygon and line features (boundaries, zones)
- MapLibre raster/vector source — basemap from GeoServer WMTS or OpenFreeMap

## Interaction

- Click on a deck.gl feature → `setSelectedFeature` → `FeaturePopup` renders properties
- `LayerPanel` toggles `layerVisibility` in Zustand → `layers/index.js` rebuilds layer array
- Viewport changes propagate through react-map-gl's `onMove` → `setViewport`

## Deployment Target

Internal Chromium-only intranet + public portal. WebGPU is guaranteed; no fallback to WebGL required for MVP.

## Out of Scope (MVP)

- Time slider / animation
- Feature editing / drawing
- Authentication UI (interceptor slot reserved but not implemented)
- Mobile / non-Chromium support