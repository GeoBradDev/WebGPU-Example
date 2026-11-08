import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useMapStore } from '../store/mapStore.js'

// Issue #10: render device and basemap health. jsdom has no WebGL or WebGPU,
// so the map, the deck overlay, and the GPU hooks are stubbed. The Map mock
// captures its props so the test can play MapLibre's part (onError, onLoad),
// and the overlay mock records its constructor props so the test can play
// deck.gl's part (onDeviceInitialized, onError).
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

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function fakeDevice() {
  const lost = deferred()
  return { device: { type: 'webgl', info: { renderer: 'ANGLE (Test)' }, lost: lost.promise }, lost }
}

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

describe('MapView render device health', () => {
  it('passes onError to the MapboxOverlay constructor next to onDeviceInitialized', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    expect(typeof overlays[0].props.onError).toBe('function')
    expect(typeof overlays[0].props.onDeviceInitialized).toBe('function')
  })

  it('shows Failed when deck reports an error before its device exists, and logs it', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const err = new Error('WebGL2 not supported')
    act(() => overlays[0].props.onError(err))
    expect(renderVal()).toHaveTextContent('Failed')
    expect(renderVal()).toHaveClass('err')
    expect(useMapStore.getState().render.status).toBe('failed')
    expect(errorSpy).toHaveBeenCalledWith(err)
  })

  it('ignores errors deck reports after the device exists', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const { device } = fakeDevice()
    act(() => overlays[0].props.onDeviceInitialized(device))
    act(() => overlays[0].props.onError(new Error('picking failed')))
    expect(renderVal()).toHaveTextContent('WebGL2')
    expect(renderVal()).toHaveClass('ok')
    expect(useMapStore.getState().render).toEqual({ status: 'ready', type: 'webgl', renderer: 'ANGLE (Test)' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('shows Lost when the device lost promise resolves while mounted', async () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const { device, lost } = fakeDevice()
    act(() => overlays[0].props.onDeviceInitialized(device))
    await act(async () => lost.resolve({ reason: 'destroyed', message: 'context lost' }))
    expect(renderVal()).toHaveTextContent('Lost')
    expect(renderVal()).toHaveClass('err')
    expect(useMapStore.getState().render.status).toBe('lost')
  })

  it('changes nothing when the device lost promise resolves after unmount', async () => {
    const { unmount } = render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    const { device, lost } = fakeDevice()
    act(() => overlays[0].props.onDeviceInitialized(device))
    unmount()
    await act(async () => lost.resolve({ reason: 'destroyed' }))
    expect(useMapStore.getState().render.status).toBe('ready')
  })
})

describe('MapView basemap health', () => {
  const fallback = () => screen.queryByText('BASEMAP UNAVAILABLE')

  it('shows the fallback message when the style fails before load', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    expect(fallback()).not.toBeInTheDocument()
    act(() => mapProps.current.onError({ type: 'error', error: new Error('style 404') }))
    expect(fallback()).toBeInTheDocument()
    expect(screen.getByText('DATA LAYERS STILL SHOWN')).toBeInTheDocument()
    expect(fallback().closest('[role="status"]')).toHaveClass('basemap-fallback')
    expect(useMapStore.getState().basemapFailed).toBe(true)
  })

  it('ignores tile and source errors', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    act(() => mapProps.current.onError({ type: 'error', error: new Error('tile 503'), sourceId: 'carto' }))
    expect(fallback()).not.toBeInTheDocument()
    expect(useMapStore.getState().basemapFailed).toBe(false)
  })

  it('ignores errors after the map has loaded', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    act(() => mapProps.current.onLoad({ type: 'load' }))
    act(() => mapProps.current.onError({ type: 'error', error: new Error('late glyph failure') }))
    expect(fallback()).not.toBeInTheDocument()
    expect(useMapStore.getState().basemapFailed).toBe(false)
  })

  it('clears the failure on load', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    act(() => mapProps.current.onError({ type: 'error', error: new Error('sprite 404') }))
    expect(fallback()).toBeInTheDocument()
    act(() => mapProps.current.onLoad({ type: 'load' }))
    expect(fallback()).not.toBeInTheDocument()
    expect(useMapStore.getState().basemapFailed).toBe(false)
  })
})
