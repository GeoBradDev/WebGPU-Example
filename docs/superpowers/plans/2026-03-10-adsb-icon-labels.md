# ADS-B Icon, Labels, and GPU Counter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ADS-B position dots with heading-rotated airplane icon TextLayers and per-aircraft callsign/country labels, and update the GPU info panel point counter to include ADS-B aircraft.

**Architecture:** Add `country` to `fetchOpenSky` normalization; replace the `adsb-positions` ScatterplotLayer with two TextLayers (`adsb-icons` for the rotated airplane character, `adsb-labels` for the callsign/country text); update `activePointCount` in MapView to sum AIS + ADS-B.

**Tech Stack:** React 19, deck.gl 9.2 (TextLayer), Vitest

---

## Chunk 1: Data

### Task 1: Update `src/api/opensky.js`

**Files:**
- Modify: `src/api/opensky.js`

Add `country: s[2]` to the normalized aircraft object. Update the state vector index comment and JSDoc `@returns` type.

- [ ] **Edit the JSDoc `@returns` type on `fetchOpenSky`**

```js
// Before:
 * @returns {Promise<Array<{icao24, callsign, lon, lat, velocity, heading}>>}

// After:
 * @returns {Promise<Array<{icao24, callsign, country, lon, lat, velocity, heading}>>}
```

- [ ] **Edit the state vector index comment**

```js
// Before:
  // OpenSky state vector field indices (see https://openskynetwork.github.io/opensky-api/rest.html)
  // [0] icao24, [1] callsign, [5] longitude, [6] latitude, [9] velocity (m/s), [10] true track (heading)

// After:
  // OpenSky state vector field indices (see https://openskynetwork.github.io/opensky-api/rest.html)
  // [0] icao24, [1] callsign, [2] origin_country, [5] longitude, [6] latitude, [9] velocity (m/s), [10] true track (heading)
```

- [ ] **Add `country: s[2]` to the `.map()` call**

```js
// Before:
    .map((s) => ({
      icao24: s[0],
      callsign: s[1]?.trim() || null,
      lon: s[5],
      lat: s[6],
      velocity: s[9],
      heading: s[10],
    }))

// After:
    .map((s) => ({
      icao24: s[0],
      callsign: s[1]?.trim() || null,
      country: s[2],
      lon: s[5],
      lat: s[6],
      velocity: s[9],
      heading: s[10],
    }))
```

- [ ] **Run the opensky tests to confirm they still pass**

```bash
npx vitest run src/api/opensky.test.js
```

Expected: 5 tests pass (these tests cover `buildBinaryTracks` only; `fetchOpenSky` is verified manually in the browser).

---

## Chunk 2: Layers (TDD)

### Task 2: Write failing tests in `src/layers/index.test.js`

**Files:**
- Modify: `src/layers/index.test.js`

Add `TextLayer` to the mock. Replace the existing ADSB branch tests with updated assertions covering `adsb-icons`, `adsb-labels`, the angle formula, and all four label text edge cases. The new tests will fail because `index.js` still uses `ScatterplotLayer` for `adsb-positions`.

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
  TextLayer: class {
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

const mockPosition = {
  icao24: 'abc123',
  callsign: 'UAL123',
  country: 'United States',
  lon: 10,
  lat: 20,
  velocity: 200,
  heading: 90,
}

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
  it('includes adsb-tracks, adsb-icons, and adsb-labels when adsb is visible', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).toContain('adsb-tracks')
    expect(ids).toContain('adsb-icons')
    expect(ids).toContain('adsb-labels')
  })

  it('does not include adsb-positions (replaced by icon+label layers)', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('adsb-positions')
  })

  it('omits adsb layers when adsb is false', () => {
    const layers = buildLayers(
      { points: false, adsb: false },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).not.toContain('adsb-tracks')
    expect(ids).not.toContain('adsb-icons')
    expect(ids).not.toContain('adsb-labels')
  })

  it('adsb-icons getAngle: heading 0 returns 90 (north-pointing offset)', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-icons')
    expect(layer.props.getAngle({ heading: 0 })).toBe(90)
  })

  it('adsb-icons getAngle: heading 90 returns 0 (east-pointing)', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-icons')
    expect(layer.props.getAngle({ heading: 90 })).toBe(0)
  })

  it('adsb-icons getAngle: null heading defaults to 0 (angle returns 90)', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-icons')
    expect(layer.props.getAngle({ heading: null })).toBe(90)
  })

  it('adsb-labels getText: callsign and country both present', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-labels')
    expect(layer.props.getText({ callsign: 'UAL123', country: 'United States' })).toBe('UAL123\nUnited States')
  })

  it('adsb-labels getText: null callsign omitted', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-labels')
    expect(layer.props.getText({ callsign: null, country: 'United States' })).toBe('United States')
  })

  it('adsb-labels getText: null country omitted', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-labels')
    expect(layer.props.getText({ callsign: 'UAL123', country: null })).toBe('UAL123')
  })

  it('adsb-labels getText: both null returns empty string', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-labels')
    expect(layer.props.getText({ callsign: null, country: null })).toBe('')
  })

  it('adsb-labels is not pickable', () => {
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'adsb-labels')
    expect(layer.props.pickable).toBe(false)
  })

  it('adsb-icons onClick wraps object in properties envelope', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      handler
    )
    const layer = layers.find((l) => l.id === 'adsb-icons')
    layer.props.onClick({ object: mockPosition })
    expect(handler).toHaveBeenCalledWith({ properties: mockPosition })
  })

  it('adsb-icons onClick does not fire when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { points: false, adsb: true },
      { points: [], adsbTracks: mockBinaryTracks, adsbPositions: [mockPosition] },
      handler
    )
    const layer = layers.find((l) => l.id === 'adsb-icons')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Run the tests to confirm the new ADSB tests fail**

```bash
npx vitest run src/layers/index.test.js
```

Expected: the 5 AIS tests still pass; most new ADSB tests fail because `index.js` still has `adsb-positions` (ScatterplotLayer) not `adsb-icons`/`adsb-labels` (TextLayer).

---

### Task 3: Update `src/layers/index.js`

**Files:**
- Modify: `src/layers/index.js`

Import `TextLayer`. Replace the `adsb-positions` ScatterplotLayer with `adsb-icons` TextLayer (heading-rotated airplane character) and `adsb-labels` TextLayer (callsign + country).

- [ ] **Replace `src/layers/index.js`**

```js
import { ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers'

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
      new TextLayer({
        id: 'adsb-icons',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getText: () => '✈',
        // ✈ points right by default; +90° offset aligns it to north, then subtract heading
        getAngle: (d) => 90 - (d.heading ?? 0),
        getSize: 14,
        getColor: [0, 220, 255, 220],
        billboard: false,
        pickable: true,
        // Wrap in { properties } so FeaturePopup renders key/value pairs correctly
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

  return layers
}
```

- [ ] **Run the layer tests to confirm all 18 tests pass**

```bash
npx vitest run src/layers/index.test.js
```

Expected: all 18 tests pass (5 AIS + 13 ADSB).

---

## Chunk 3: GPU counter and verification

### Task 4: Update `src/components/MapView.jsx`

**Files:**
- Modify: `src/components/MapView.jsx`

Update `activePointCount` to sum AIS vessels and ADS-B aircraft positions. Only one line changes.

- [ ] **Edit the `activePointCount` line**

```js
// Before:
  const activePointCount = layerVisibility.points ? (layerData.points?.length ?? 0) : 0

// After:
  const activePointCount =
    (layerVisibility.points ? (layerData.points?.length ?? 0) : 0) +
    (layerVisibility.adsb ? (layerData.adsbPositions?.length ?? 0) : 0)
```

---

### Task 5: Run full test suite and verify in the browser

**Files:** (none)

- [ ] **Run all tests**

```bash
npx vitest run
```

Expected: all tests pass: `opensky.test.js` (5), `layers/index.test.js` (18), `store/mapStore.test.js` (4), `components/FeaturePopup.test.jsx` (3), `components/LayerPanel.test.jsx` (3). Total: 33 tests, zero failures.

- [ ] **Start the dev server**

```bash
npm run dev
```

- [ ] **Verify in the browser**

Open the app and check:

1. ADS-B positions now render as airplane characters (not dots) in cyan
2. Each airplane character is rotated to match the aircraft's heading (aircraft flying east point right, north point up)
3. Below each airplane character, a two-line label shows callsign (e.g. `UAL123`) and country (e.g. `United States`)
4. Aircraft with no callsign show only the country; aircraft with neither show no label
5. The `PTS` counter in the GPU info panel now shows the combined AIS vessel + ADS-B aircraft count
6. Toggling the ADS-B layer off hides tracks, icons, and labels together
7. Clicking an airplane icon opens FeaturePopup showing `icao24`, `callsign`, `country`, `lon`, `lat`, `velocity`, `heading`
8. Clicking an AIS vessel still works correctly
9. No console errors