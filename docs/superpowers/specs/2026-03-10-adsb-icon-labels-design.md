# ADS-B Icon, Labels, and GPU Counter - Design

## Context

Extension of the ADS-B tracks sub-project. The current implementation renders aircraft positions as cyan dots (ScatterplotLayer). This sub-project replaces the dot with a heading-rotated airplane icon (✈ TextLayer), adds per-aircraft callsign and country labels (second TextLayer), adds origin_country to the normalized data, and updates the GPUInfoPanel PTS counter to include ADS-B aircraft.

## Data

`fetchOpenSky` currently drops `s[2]` (origin_country). Add it to the normalized aircraft object:

```js
{ icao24: s[0], callsign: s[1]?.trim() || null, country: s[2], lon: s[5], lat: s[6], velocity: s[9], heading: s[10] }
```

State vector index comment updated to include `[2] origin_country`.

`useADSB` and `buildBinaryTracks` are unchanged — they pass through whatever `fetchOpenSky` returns. `country` arrives in `currentPositions` automatically.

## Layers

The `adsb-positions` ScatterplotLayer is replaced by two TextLayers. The `adsb-tracks` PathLayer is unchanged.

**`adsb-icons`** — airplane character, rotated to heading:
```js
new TextLayer({
  id: 'adsb-icons',
  data: data.adsbPositions ?? [],
  getPosition: d => [d.lon, d.lat],
  getText: () => '✈',
  getAngle: d => 90 - (d.heading ?? 0),  // ✈ points right by default; +90° offset aligns to north
  getSize: 14,
  getColor: [0, 220, 255, 220],
  billboard: false,
  pickable: true,
  onClick: ({ object }) => object && onFeatureClick({ properties: object }),
})
```

**`adsb-labels`** — callsign + country below the icon:
```js
new TextLayer({
  id: 'adsb-labels',
  data: data.adsbPositions ?? [],
  getPosition: d => [d.lon, d.lat],
  getText: d => [d.callsign, d.country].filter(Boolean).join('\n'),
  getSize: 10,
  getColor: [0, 220, 255, 160],
  getPixelOffset: [0, 14],
  billboard: false,
  pickable: false,
})
```

`billboard: false` keeps icons and labels flat on the map (not camera-facing when tilted). The angle formula `90 - heading` corrects for the ✈ character's default right-pointing orientation.

## GPU Counter

`activePointCount` in `MapView.jsx` currently counts AIS vessels only. Updated to include ADS-B:

```js
const activePointCount =
  (layerVisibility.points ? (layerData.points?.length ?? 0) : 0) +
  (layerVisibility.adsb ? (layerData.adsbPositions?.length ?? 0) : 0)
```

`GPUInfoPanel.jsx` is unchanged — it already renders `activePointCount` as the `PTS` readout.

## Files Changed

### Modified
- `src/api/opensky.js` - add `country: s[2]` to normalized object; update index comment to include `[2] origin_country`; update JSDoc `@returns` type to include `country`
- `src/layers/index.js` - import `TextLayer` from `@deck.gl/layers` alongside `ScatterplotLayer` and `PathLayer`; replace `adsb-positions` ScatterplotLayer with `adsb-icons` + `adsb-labels` TextLayers
- `src/layers/index.test.js` - mock `TextLayer`; replace `adsb-positions` test assertions with `adsb-icons` and `adsb-labels`; add angle formula test; add label format test
- `src/components/MapView.jsx` - update `activePointCount` to sum AIS + ADS-B

### Unchanged
- `src/hooks/useADSB.js`
- `src/components/GPUInfoPanel.jsx`
- `src/components/FeaturePopup.jsx` - already renders arbitrary properties; `country` appears automatically on click

## Testing

- `src/layers/index.test.js`:
  - Mock `TextLayer` alongside existing `ScatterplotLayer` and `PathLayer` mocks
  - Assert `adsb-icons` and `adsb-labels` layer ids present when `adsb: true`
  - Assert `adsb-positions` id is absent (replaced)
  - Assert `adsb-icons` angle formula: for heading 0, `getAngle({heading: 0})` returns 90; for heading 90, returns 0
  - Assert `adsb-labels` text format covers all edge cases: (a) both callsign and country present → `'UAL123\nUnited States'`; (b) callsign only (null country) → `'UAL123'`; (c) country only (null callsign) → `'United States'`; (d) both null → `''`
  - Assert `adsb-labels` is not pickable
  - Existing click-wrapping test updated to target `adsb-icons` instead of `adsb-positions`

- `src/api/opensky.test.js`: No new tests for `fetchOpenSky` (per project policy on fetch wrappers). `country` field verified manually in browser via FeaturePopup click.

## Out of Scope

- Icon sprite atlas (using Unicode ✈ character instead)
- Label declutter / collision avoidance
- Label visibility zoom threshold
- Heading-unavailable fallback styling (null heading defaults to 0 — points north)