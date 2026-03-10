import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from './mapStore'

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
    setViewport({ longitude: 10, latitude: 20, zoom: 8, pitch: 0, bearing: 0 })
    const { viewport } = useMapStore.getState()
    expect(viewport.zoom).toBe(8)
    expect(viewport.longitude).toBe(10)
  })

  it('setLayerVisibility toggles a layer', () => {
    const { setLayerVisibility } = useMapStore.getState()
    setLayerVisibility('points', false)
    expect(useMapStore.getState().layerVisibility.points).toBe(false)
  })

  it('setSelectedFeature stores feature', () => {
    const { setSelectedFeature } = useMapStore.getState()
    const feature = { id: '1', properties: { name: 'Test' } }
    setSelectedFeature(feature)
    expect(useMapStore.getState().selectedFeature).toEqual(feature)
  })
})