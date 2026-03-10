# ADS-B Tracks - Sub-project 3 Design

## Context

Sequential data layer project. Sub-project 1 (AIS vessels, ScatterplotLayer) is complete. This is Sub-project 3: ADS-B aircraft tracks rendered via deck.gl PathLayer using binary data format for direct GPU upload. No Arrow encoding; binary here means deck.gl's typed array binary input format (Float32Array + Uint32Array startIndices).

## Approach

Object accumulation with binary encoding at flush time. Track history is stored as a plain `Map<icao24, [lng, lat][]>` in a ref. Each flush interval a pure transform function builds typed arrays for PathLayer. A parallel plain array feeds a ScatterplotLayer for current positions.

## Data Source

**Endpoint:** `https://opensky-network.org/api/states/all`
**Format:** JSON - `{ states: Array<Array> }` where each element is a flat state vector
**Auth:** None (anonymous tier)
**CORS:** Supported
**Poll interval:** 10 seconds (anonymous rate limit)
**Coverage:** Global

State vector field indices:
- `[0]` icao24 (string)
- `[1]` callsign (string, may be null)
- `[5]` longitude (float, may be null)
- `[6]` latitude (float, may be null)
- `[9]` velocity m/s (float, may be null)
- `[10]` heading degrees (float, may be null)

Aircraft with null lat or lon are filtered before normalization.

## Track Accumulation

- `Map<icao24, [lng, lat][]>` held in a `useRef` inside `useADSB`
- On each successful poll: append `[lon, lat]` to each aircraft's track array
- Rolling window: `OPENSKY_MAX_TRACK_POINTS = 20` - shift oldest when exceeded
- Aircraft not in the latest poll retain their track (not pruned mid-session)
- Flush interval: 1 second (`OPENSKY_FLUSH_INTERVAL`)

## Binary Encoding

`buildBinaryTracks(trackMap)` is a pure function in `src/api/opensky.js`. Input: the track map. Output: deck.gl binary PathLayer format:

```js
{
  length: numPaths,
  startIndices: Uint32Array,
  attributes: {
    getPath: { value: Float32Array, size: 2 },  // flat [lng0, lat0, lng1, lat1, ...]
  }
}
```

Paths with fewer than 2 points are excluded (PathLayer requires at least 2 vertices).

## Layers

Both toggled by `layerVisibility.adsb`.

**PathLayer** (trails):
- `id: 'adsb-tracks'`
- `data`: binary object from `buildBinaryTracks`
- `_pathType: 'open'`
- `getWidth: 1`, `widthUnits: 'pixels'`
- `getColor: [0, 180, 255, 160]`
- Not pickable

**ScatterplotLayer** (current positions):
- `id: 'adsb-positions'`
- `data`: plain array of `{ icao24, callsign, lon, lat, velocity, heading }`
- `getPosition: d => [d.lon, d.lat]`
- `getRadius: 4`, `radiusUnits: 'pixels'`
- `getFillColor: [0, 220, 255, 220]`
- `pickable: true`, `onClick` passes object to `onFeatureClick`

## Files Changed

### Added
- `src/api/opensky.js` - `fetchOpenSky()` fetch + `buildBinaryTracks(trackMap)` pure transform
- `src/hooks/useADSB.js` - accumulation hook, returns `{ binaryTracks, currentPositions, connected, error }`

### Modified
- `src/config/sources.js` - add `OPENSKY_URL`, `OPENSKY_POLL_INTERVAL`, `OPENSKY_FLUSH_INTERVAL`, `OPENSKY_MAX_TRACK_POINTS`; add `LAYERS.ADSB`
- `src/layers/index.js` - import `PathLayer`; add `adsb` branch (PathLayer + ScatterplotLayer)
- `src/store/mapStore.js` - add `adsb: true` to initial `layerVisibility`
- `src/components/LayerPanel.jsx` - add ADS-B row
- `src/App.jsx` - import `useADSB`; add `binaryTracks` and `currentPositions` to `layerData`

### Unchanged
- `src/components/MapView.jsx`
- `src/components/FeaturePopup.jsx`
- `src/api/ais.js`
- `src/hooks/useAIS.js`

## Data Flow

```
OpenSky REST API (10s poll)
        |
   opensky.js - fetch, normalize state vectors, filter null positions
        |
   useADSB hook
   - append to Map<icao24, track[]>
   - rolling window (max 20 points)
   - flush interval (1s): buildBinaryTracks() + extract currentPositions
   - returns { binaryTracks, currentPositions, connected, error }
        |
     App.jsx
   - layerData.adsbTracks = binaryTracks
   - layerData.adsbPositions = currentPositions
        |
   layers/index.js - buildLayers()
   - PathLayer (binary) for trails
   - ScatterplotLayer for current positions
        |
   DeckGLOverlay -> WebGPU
```

## Error Handling

- **Poll failure** (network error, non-2xx, JSON parse failure): retain last `binaryTracks` and `currentPositions`, set `error`, no blank map
- **Empty states array**: legitimate response, renders empty, not treated as error
- **Null lat/lon**: filtered in `fetchOpenSky()` before normalization
- **Single-point tracks**: excluded from PathLayer binary (fewer than 2 vertices), still appear in ScatterplotLayer
- `connected` and `error` exposed by hook, not consumed by UI

## Testing

- `buildBinaryTracks`: unit tested in `src/api/opensky.test.js` - verify `startIndices`, flat array length, vertex ordering, and exclusion of single-point tracks
- `src/layers/index.test.js`: add coverage for `adsb` branch (PathLayer + ScatterplotLayer construction)
- No unit tests for `useADSB` (thin polling hook, same rationale as `useAIS`)

## Out of Scope

- Arrow binary encoding (deferred to later sub-project)
- Web Worker offloading
- Per-aircraft color encoding by altitude or velocity
- Heading indicator icons
- Bounding box filtering (fetch global, filter client-side if needed later)
- Historical playback