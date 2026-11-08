import { describe, it, expect, vi } from 'vitest'

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
  BitmapLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
}))

import { buildLayers } from './index.js'
import { HEATMAP_BOUNDS } from './heatmapProjection.js'

const mockAirport = { lon: 10, lat: 20, name: 'Test Airport', type: 'large_airport' }
const mockPort = { lon: 30, lat: 40, name: 'Test Port' }

describe('buildLayers', () => {
  const mockCanvas = document.createElement('canvas')

  it('returns an array', () => {
    const layers = buildLayers(
      { airports: true, ports: true },
      { airports: [mockAirport], ports: [mockPort] },
      vi.fn()
    )
    expect(Array.isArray(layers)).toBe(true)
  })

  it('includes airports layer when visible', () => {
    const layers = buildLayers(
      { airports: true, ports: false },
      { airports: [mockAirport], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('airports')
  })

  it('omits airports layer when not visible', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [mockAirport], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('airports')
  })

  it('airports onClick wraps object in properties envelope', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { airports: true, ports: false },
      { airports: [mockAirport], ports: [] },
      handler
    )
    const layer = layers.find((l) => l.id === 'airports')
    layer.props.onClick({ object: mockAirport })
    expect(handler).toHaveBeenCalledWith({ properties: mockAirport })
  })

  it('airports onClick does not fire when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { airports: true, ports: false },
      { airports: [mockAirport], ports: [] },
      handler
    )
    const layer = layers.find((l) => l.id === 'airports')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })

  // Issue #9: zoom-scaled radius so points do not bury basemap labels at zoom 2.
  it('airports layer sizes points in meters, clamped in pixels', () => {
    const layers = buildLayers(
      { airports: true, ports: false },
      { airports: [mockAirport], ports: [] },
      vi.fn()
    )
    const { props } = layers.find((l) => l.id === 'airports')
    expect(props.radiusUnits).toBe('meters')
    expect(props.radiusMinPixels).toBeGreaterThan(0)
    expect(props.radiusMaxPixels).toBeGreaterThan(props.radiusMinPixels)
  })

  it('airports layer draws large airports bigger than medium ones', () => {
    const layers = buildLayers(
      { airports: true, ports: false },
      { airports: [mockAirport], ports: [] },
      vi.fn()
    )
    const { getRadius } = layers.find((l) => l.id === 'airports').props
    expect(typeof getRadius).toBe('function')
    const large = getRadius({ ...mockAirport, type: 'large_airport' })
    const medium = getRadius({ ...mockAirport, type: 'medium_airport' })
    expect(medium).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(medium)
  })

  it('includes ports layer when visible', () => {
    const layers = buildLayers(
      { airports: false, ports: true },
      { airports: [], ports: [mockPort] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('ports')
  })

  it('omits ports layer when not visible', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [], ports: [mockPort] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('ports')
  })

  it('ports onClick wraps object in properties envelope', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { airports: false, ports: true },
      { airports: [], ports: [mockPort] },
      handler
    )
    const layer = layers.find((l) => l.id === 'ports')
    layer.props.onClick({ object: mockPort })
    expect(handler).toHaveBeenCalledWith({ properties: mockPort })
  })

  it('ports onClick does not fire when object is null', () => {
    const handler = vi.fn()
    const layers = buildLayers(
      { airports: false, ports: true },
      { airports: [], ports: [mockPort] },
      handler
    )
    const layer = layers.find((l) => l.id === 'ports')
    layer.props.onClick({ object: null })
    expect(handler).not.toHaveBeenCalled()
  })

  it('both layers present when all visible', () => {
    const layers = buildLayers(
      { airports: true, ports: true },
      { airports: [mockAirport], ports: [mockPort] },
      vi.fn()
    )
    const ids = layers.map((l) => l.id)
    expect(ids).toContain('airports')
    expect(ids).toContain('ports')
    expect(layers).toHaveLength(2)
  })

  const mockStressPoints = {
    length: 10,
    attributes: { getPosition: { value: new Float32Array(30), size: 3 } },
  }

  it('includes stress layer when stressPoints has length > 0', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [], ports: [], stressPoints: mockStressPoints },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('stress')
  })

  it('omits stress layer when stressPoints is empty object', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [], ports: [], stressPoints: {} },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('stress')
  })

  it('omits stress layer when stressPoints is undefined', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [], ports: [] },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('stress')
  })

  it('stress layer is not pickable', () => {
    const layers = buildLayers(
      { airports: false, ports: false },
      { airports: [], ports: [], stressPoints: mockStressPoints },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'stress')
    expect(layer.props.pickable).toBe(false)
  })

  it('includes heatmap layer when visible and canvas provided', () => {
    const layers = buildLayers(
      { airports: false, ports: false, heatmap: true },
      { airports: [], ports: [], heatmapCanvas: mockCanvas },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).toContain('heatmap')
  })

  it('heatmap layer is first (renders under points)', () => {
    const layers = buildLayers(
      { airports: true, ports: false, heatmap: true },
      { airports: [mockAirport], ports: [], heatmapCanvas: mockCanvas },
      vi.fn()
    )
    expect(layers[0].id).toBe('heatmap')
  })

  it('omits heatmap when heatmap visibility is false', () => {
    const layers = buildLayers(
      { airports: false, ports: false, heatmap: false },
      { airports: [], ports: [], heatmapCanvas: mockCanvas },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('heatmap')
  })

  it('omits heatmap when heatmapCanvas is null', () => {
    const layers = buildLayers(
      { airports: false, ports: false, heatmap: true },
      { airports: [], ports: [], heatmapCanvas: null },
      vi.fn()
    )
    expect(layers.map((l) => l.id)).not.toContain('heatmap')
  })

  it('heatmap layer has correct bounds', () => {
    const layers = buildLayers(
      { airports: false, ports: false, heatmap: true },
      { airports: [], ports: [], heatmapCanvas: mockCanvas },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'heatmap')
    expect(layer.props.bounds).toEqual([-180, -85.051129, 180, 85.051129])
  })

  it('heatmap layer bounds come from the shared projection helper', () => {
    const layers = buildLayers(
      { airports: false, ports: false, heatmap: true },
      { airports: [], ports: [], heatmapCanvas: mockCanvas },
      vi.fn()
    )
    const layer = layers.find((l) => l.id === 'heatmap')
    expect(layer.props.bounds).toEqual(HEATMAP_BOUNDS)
    expect(layer.props._imageCoordinateSystem).toBeUndefined()
  })
})
