import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useMapStore } from '../store/mapStore.js'

// Issue #10 review finding C: when MapLibre itself cannot be created (no
// usable WebGL2, or the maplibre import rejects), react-maplibre calls onError
// with target: null and never renders its children, so the deck overlay never
// mounts. The fallback must not claim the data layers are still shown: it
// says MAP UNAVAILABLE / WEBGL2 REQUIRED, RENDER is Failed, and the store
// records both the render failure and the basemap failure.
//
// jsdom has no WebGL or WebGPU: the map, the deck overlay, and the GPU hooks
// are stubbed. The Map mock captures its props so the test can play
// react-maplibre's part.
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
const renderVal = () => screen.getByText('RENDER').closest('.gpu-info-item').querySelector('.gpu-info-val')

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

describe('MapView when the map cannot be created', () => {
  it('shows MAP UNAVAILABLE / WEBGL2 REQUIRED and marks render and basemap failed', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const error = new Error('Failed to initialize WebGL')
    act(() => mapProps.current.onError({ type: 'error', target: null, originalEvent: null, error }))

    const fallback = document.querySelector('.basemap-fallback')
    expect(fallback).toHaveAttribute('role', 'status')
    expect(fallback).toHaveTextContent('MAP UNAVAILABLE')
    expect(fallback).toHaveTextContent('WEBGL2 REQUIRED')
    expect(fallback).not.toHaveTextContent('DATA LAYERS STILL SHOWN')
    expect(fallback).not.toHaveTextContent('BASEMAP UNAVAILABLE')

    expect(renderVal()).toHaveTextContent('Failed')
    expect(useMapStore.getState().render.status).toBe('failed')
    expect(useMapStore.getState().basemapFailed).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith(error)
  })
})
