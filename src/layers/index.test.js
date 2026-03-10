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