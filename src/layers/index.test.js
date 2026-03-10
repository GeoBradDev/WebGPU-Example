import { describe, it, expect, vi } from 'vitest'

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
  GeoJsonLayer: class {
    constructor(props) { Object.assign(this, { id: props.id, props }) }
  },
}))

import { buildLayers } from './index.js'

const mockData = {
  points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-98, 39] }, properties: { name: 'A' } }],
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