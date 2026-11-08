import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useMapStore } from './store/mapStore.js'
import { AIRPORTS_DATA_URL } from './config/sources.js'
import App from './App.jsx'

// jsdom has no WebGL or WebGPU: stub the map and the GPU heatmap hook.
vi.mock('./components/MapView.jsx', () => ({
  MapView: ({ layerData }) => (
    <div data-testid="map-view">
      airports:{layerData.airports.length} ports:{layerData.ports.length}
    </div>
  ),
}))

vi.mock('./hooks/useGPUHeatmap.js', () => ({
  useGPUHeatmap: () => ({ canvas: null, computeMs: 0, supported: false, error: null, status: 'unsupported', retry: () => {} }),
}))

const AIRPORTS = {
  version: 1,
  types: ['large_airport', 'medium_airport', 'small_airport'],
  lon: [-118.4],
  lat: [33.9],
  name: ['LAX'],
  type: [0],
}
const GEOJSON = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [4.4, 51.9] }, properties: { PORT_NAME: 'Rotterdam' } }],
}

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url === AIRPORTS_DATA_URL) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(AIRPORTS) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(GEOJSON) })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the header title, layer panel, and map', async () => {
    render(<App />)

    expect(screen.getByText('WebGPU Groundtruth')).toBeInTheDocument()
    expect(screen.getByText('SENSOR LAYERS')).toBeInTheDocument()
    expect(screen.getByText('STRESS TEST')).toBeInTheDocument()
    expect(screen.getByTestId('map-view')).toBeInTheDocument()
    // heatmap row hidden because the mocked hook reports unsupported
    expect(screen.queryByText('HEATMAP')).not.toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByTestId('map-view')).toHaveTextContent('airports:1 ports:1')
    )
  })
})
