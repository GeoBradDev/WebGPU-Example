# AIS Vessels - Sub-project 1 Design

## Context

Standalone WebGPU learning project. Goal is real geospatial data rendered via deck.gl's WebGPU backend. GeoServer integration is being removed entirely. This is the first of six sequential data layers (AIS, SIGINT/ACLED, ADS-B, SAR/COG, DuckDB, custom WGSL shader).

## Approach

Raw fetch + ScatterplotLayer. Poll the digitraffic.fi REST API every 30 seconds, pass the GeoJSON response directly to a deck.gl ScatterplotLayer. No binary encoding, no workers, no additional dependencies.

## Data Source

**Endpoint:** `https://meri.digitraffic.fi/api/vessel-location/v1/locations`
**Format:** GeoJSON FeatureCollection
**Auth:** None required
**CORS:** Enabled
**Update cadence:** ~30 seconds
**Coverage:** Finnish coastal vessels

Response shape:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [lon, lat] },
      "properties": {
        "mmsi": 123456789,
        "sog": 5.2,
        "cog": 180,
        "navStat": 0,
        "heading": 180
      }
    }
  ]
}
```

## Files Changed

### Removed
- `src/api/geoserver.js`
- `src/hooks/useLayerData.js`

### Added
- `src/api/ais.js` - fetch wrapper for the digitraffic.fi endpoint
- `src/hooks/useAIS.js` - polling hook, 30s interval, returns `{ vessels, loading, error }`

The project uses `.jsx` for component files and `.js` for hooks, api, config, and layer files.

### Modified
- `src/config/sources.js` - remove GeoServer layer defs; add AIS endpoint URL and poll interval constant; keep `BASEMAP_STYLE` and `DEFAULT_VIEW`
- `src/layers/index.js` - remove GeoJsonLayer branch (including the `layerVisibility.polygons` check and `layerData.polygons` access); replace points ScatterplotLayer with AIS ScatterplotLayer; flat color, `getPosition` from GeoJSON coordinates
- `src/App.jsx` - replace `useLayerData` calls with `useAIS`; construct `layerData` as `{ points: vessels }` (no `polygons` key)
- `src/components/LayerPanel.jsx` - update layer list to show single AIS toggle

### Unchanged
- `src/components/MapView.jsx` - no changes needed
- `src/components/GPUInfoPanel.jsx` - active point count already reads `layerData.points.length`
- `src/store/mapStore.js` - no changes needed
- `src/components/FeaturePopup.jsx` - no changes needed

## Data Shapes

`useAIS` returns `{ vessels, loading, error }` where `vessels` is the `features` array from the GeoJSON FeatureCollection (not the FeatureCollection object itself). App.jsx passes this array as `layerData.points`. `layerData.points.length` is therefore always a valid number.

`buildLayers(layerVisibility, layerData)` continues to accept the same generic signature. `layerData.points` is the AIS features array. `layerData.polygons` is removed.

Features with null or missing `geometry` are filtered out in `ais.js` before the array is returned, so `getPosition: d => d.geometry.coordinates` is safe.

## Data Flow

```
digitraffic.fi REST API
        |
   ais.js - fetch, parse JSON, filter null geometries, return features array
        |
   useAIS hook
   - fetch on mount
   - setInterval 30s (interval starts from dispatch, not resolve)
   - clearInterval on unmount
   - returns { vessels, loading, error }
        |
     App.jsx
   - passes vessels as layerData.points
        |
   layers/index.js - buildLayers()
   - ScatterplotLayer, flat color
   - getPosition: d => d.geometry.coordinates
        |
   DeckGLOverlay -> WebGPU
```

## Error Handling

- **Poll failure** (network error, non-2xx status, JSON parse failure): retain last successful `vessels` array, set `error` state, no blank map
- **Initial load failure**: `vessels` is empty array, map renders empty, `error` is set
- **Empty features array**: legitimate API response, renders empty map silently, not treated as an error
- **No retry logic**: next scheduled poll fires in 30s
- `loading` is `true` only during the initial fetch. It stays `false` on subsequent poll cycles. `error` is reset to `null` at the start of each poll cycle, before the request fires.
- `loading` and `error` are exposed by the hook but not consumed by any current UI component

## FeaturePopup

`FeaturePopup` is already property-agnostic: it iterates over whatever `feature.properties` contains and renders key/value pairs. No changes needed. AIS properties (`mmsi`, `sog`, `cog`, `navStat`, `heading`) will render correctly as-is.

## Testing

- Delete `useLayerData.test.js` and `geoserver.test.js`
- Update `layers/index.test.js`: existing tests cover the old GeoServer layer definitions and will need to be rewritten against the new AIS ScatterplotLayer construction
- No new unit tests for `useAIS.js` or `ais.js`: the hook logic is thin (fetch, filter, setInterval) and the project has no test coverage policy requiring it. Polling behavior and null geometry filtering verified manually in browser.

## Out of Scope

- Arrow binary encoding (Sub-project 3, ADS-B)
- DuckDB filtering (Sub-project 5)
- Vessel icons or heading indicators
- navStat color encoding
- Global AIS coverage (deferred until a broader feed is needed)