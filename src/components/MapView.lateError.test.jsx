import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useMapStore } from '../store/mapStore.js'

// Issue #10 review finding E: deck.gl can report an error after MapView has
// unmounted (an async pick rejection, or a pending AnimationLoop start). The
// unmount cleanup clears the device ref, so a late error used to look like a
// device creation failure and wrote render failed into the global store. A
// late error must only be logged.
//
// jsdom has no WebGL or WebGPU: the map, the deck overlay, and the GPU hooks
// are stubbed. The overlay mock records its constructor props so the test can
// play deck.gl's part.
const overlays = vi.hoisted(() => [])
const mapProps = vi.hoisted(() => ({ current: null }))

vi.mock('react-map-gl/maplibre', async () => {
  const { useState } = await import('react')
  return {
    default: (props) => {
      mapProps.current = props
      return <div data-testid="map">{props.children}</div>
    },
    useControl: (factory) => {
      const [control] = useState(factory)
      return control
    },
  }
})

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    constructor(props) {
      this.props = props
      overlays.push(this)
    }
    setProps() {}
  },
}))

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
vi.mock('../config/maplibreWorker.js', () => ({}))
vi.mock('../layers/index.js', () => ({ buildLayers: () => [] }))

const GPU_BASE = { tier: 'webgpu', adapterInfo: {} }
vi.mock('../hooks/useGPUCapabilities.js', () => ({ useGPUCapabilities: () => GPU_BASE }))

const COMPUTE = { throughput: '--', supported: false, running: false, run: () => {} }
vi.mock('../hooks/useGPUCompute.js', () => ({ useGPUCompute: () => COMPUTE }))

import { MapView } from './MapView.jsx'

const layerData = { airports: [], ports: [], stressPoints: [] }

let errorSpy

beforeEach(() => {
  overlays.length = 0
  mapProps.current = null
  useMapStore.setState(useMapStore.getInitialState())
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('MapView deck error after unmount', () => {
  it('logs a late deck error but leaves the render status alone', () => {
    const { unmount } = render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const { onDeviceInitialized, onError } = overlays[0].props
    act(() => onDeviceInitialized({ type: 'webgl', info: { renderer: 'ANGLE' }, lost: new Promise(() => {}) }))
    unmount()

    const late = new Error('pick rejected after unmount')
    onError(late)

    expect(errorSpy).toHaveBeenCalledWith(late)
    expect(useMapStore.getState().render).toEqual({ status: 'ready', type: 'webgl', renderer: 'ANGLE' })
  })

  it('logs a late deck error before any device but leaves the render status alone', () => {
    const { unmount } = render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const { onError } = overlays[0].props
    unmount()

    const late = new Error('AnimationLoop start rejected after unmount')
    onError(late)

    expect(errorSpy).toHaveBeenCalledWith(late)
    expect(useMapStore.getState().render.status).toBe('detecting')
  })
})
