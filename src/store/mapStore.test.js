import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from './mapStore'

describe('mapStore', () => {
  beforeEach(() => {
    useMapStore.setState(useMapStore.getInitialState())
  })

  it('has default viewport', () => {
    const { viewport } = useMapStore.getState()
    expect(viewport.zoom).toBe(2)
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

  it('has default layer visibility for airports and ports', () => {
    const { layerVisibility } = useMapStore.getState()
    expect(layerVisibility.airports).toBe(true)
    expect(layerVisibility.ports).toBe(true)
  })

  it('setLayerVisibility toggles a layer', () => {
    const { setLayerVisibility } = useMapStore.getState()
    setLayerVisibility('airports', false)
    expect(useMapStore.getState().layerVisibility.airports).toBe(false)
  })

  it('setSelectedFeature stores feature', () => {
    const { setSelectedFeature } = useMapStore.getState()
    const feature = { id: '1', properties: { name: 'Test' } }
    setSelectedFeature(feature)
    expect(useMapStore.getState().selectedFeature).toEqual(feature)
  })

  it('has default stressCount of 0', () => {
    const { stressCount } = useMapStore.getState()
    expect(stressCount).toBe(0)
  })

  it('setStressCount updates stressCount', () => {
    const { setStressCount } = useMapStore.getState()
    setStressCount(500000)
    expect(useMapStore.getState().stressCount).toBe(500000)
  })
})