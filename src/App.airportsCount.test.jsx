import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useMapStore } from './store/mapStore.js'
import { AIRPORTS_DATA_URL } from './config/sources.js'
import App from './App.jsx'

// Issue #9: the heatmap bins every included airport, while the points layer
// and its panel count are large plus medium only.

vi.mock('./components/MapView.jsx', () => ({
  MapView: ({ layerData }) => (
    <div data-testid="map-view">points:{layerData.airports.length}</div>
  ),
}))

const heatmapCalls = vi.hoisted(() => [])
vi.mock('./hooks/useGPUHeatmap.js', () => ({
  useGPUHeatmap: (airports) => {
    heatmapCalls.push(airports)
    return airports.length > 0
      ? { canvas: 'data:,', computeMs: 1, supported: true, error: null, status: 'ready', retry: () => {} }
      : { canvas: null, computeMs: null, supported: true, error: null, status: 'waiting', retry: () => {} }
  },
}))

const AIRPORTS = {
  version: 1,
  types: ['large_airport', 'medium_airport', 'small_airport'],
  lon: [1, 2, 3, 4, 5],
  lat: [1, 2, 3, 4, 5],
  name: ['L1', 'S1', 'M1', 'S2', 'S3'],
  type: [0, 2, 1, 2, 2],
}
const GEOJSON = { type: 'FeatureCollection', features: [] }

beforeEach(() => {
  heatmapCalls.length = 0
  useMapStore.setState(useMapStore.getInitialState())
  useMapStore.setState({ render: { status: 'ready', type: 'webgl', renderer: 'Test' } })
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      url === AIRPORTS_DATA_URL
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(AIRPORTS) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(GEOJSON) })
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App airports count and heatmap input', () => {
  it('shows the large plus medium count and draws only those points', async () => {
    render(<App />)
    const airportsRow = screen.getByRole('checkbox', { name: 'Airports layer' }).closest('.layer-row')
    await waitFor(() => expect(airportsRow.nextElementSibling).toHaveTextContent('2 FEATURES'))
    expect(screen.getByTestId('map-view')).toHaveTextContent('points:2')
  })

  it('passes every included airport, small ones too, to the heatmap', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('map-view')).toHaveTextContent('points:2'))
    const last = heatmapCalls[heatmapCalls.length - 1]
    expect(last.map((a) => a.name)).toEqual(['L1', 'S1', 'M1', 'S2', 'S3'])
  })
})
