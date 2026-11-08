import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// jsdom has no WebGL or WebGPU: stub the map, the deck overlay, and the GPU
// hooks. The overlay mock records its constructor props so the test can play
// deck.gl's part and report the device it created (issue #8).
const overlays = vi.hoisted(() => [])

vi.mock('react-map-gl/maplibre', async () => {
  const { useState } = await import('react')
  return {
    default: ({ children }) => <div data-testid="map">{children}</div>,
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

describe('MapView render backend wiring', () => {
  beforeEach(() => {
    overlays.length = 0
  })

  it('shows Detecting... until deck reports its device, then the device type', () => {
    render(<MapView layerData={layerData} heatmapComputeMs={null} />)
    expect(renderVal()).toHaveTextContent('Detecting...')

    expect(overlays.length).toBeGreaterThan(0)
    const { onDeviceInitialized } = overlays[0].props
    expect(typeof onDeviceInitialized).toBe('function')

    act(() => {
      onDeviceInitialized({ type: 'webgl', info: { renderer: 'ANGLE (Test Renderer)' } })
    })

    expect(renderVal()).toHaveTextContent('WebGL2')
    expect(renderVal()).toHaveClass('ok')
    expect(screen.getByText('GPU').closest('.gpu-info-item')).toHaveTextContent('ANGLE (Test Renderer)')
  })
})
