import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useMapStore } from './store/mapStore.js'
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
  useGPUHeatmap: () => ({ canvas: null, computeMs: 0, supported: false }),
}))

const CSV = 'id,ident,type,name,latitude_deg,longitude_deg\n1,KLAX,large_airport,LAX,33.9,-118.4\n'
const GEOJSON = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [4.4, 51.9] }, properties: { PORT_NAME: 'Rotterdam' } }],
}

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url).endsWith('.csv')) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve(CSV) })
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
