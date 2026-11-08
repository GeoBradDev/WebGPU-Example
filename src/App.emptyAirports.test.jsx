import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useMapStore } from './store/mapStore.js'
import { AIRPORTS_DATA_URL } from './config/sources.js'
import App from './App.jsx'

// Issue #10 review finding A: an airports file that loads with 0 rows leaves
// the heatmap waiting on airports that will never come. The HEATMAP row must
// say NO AIRPORT DATA, not AWAITING AIRPORTS forever.

vi.mock('./components/MapView.jsx', () => ({ MapView: () => <div data-testid="map-view" /> }))

// Behaves like the real hook: waiting while airports are empty.
vi.mock('./hooks/useGPUHeatmap.js', () => ({
  useGPUHeatmap: (airports) =>
    airports.length > 0
      ? { canvas: 'data:,', computeMs: 1, supported: true, error: null, status: 'ready', retry: () => {} }
      : { canvas: null, computeMs: null, supported: true, error: null, status: 'waiting', retry: () => {} },
}))

const EMPTY_AIRPORTS = {
  version: 1,
  types: ['large_airport', 'medium_airport', 'small_airport'],
  lon: [],
  lat: [],
  name: [],
  type: [],
}
const GEOJSON = { type: 'FeatureCollection', features: [] }

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
  useMapStore.setState({ render: { status: 'ready', type: 'webgl', renderer: 'Test' } })
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      url === AIRPORTS_DATA_URL
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(EMPTY_AIRPORTS) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(GEOJSON) })
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App with an airports file that loads empty', () => {
  it('shows NO AIRPORT DATA for the heatmap, not AWAITING AIRPORTS', async () => {
    render(<App />)
    const airportsRow = screen.getByRole('checkbox', { name: 'Airports layer' }).closest('.layer-row')
    await waitFor(() => expect(airportsRow.nextElementSibling).toHaveTextContent('0 FEATURES'))

    const heatmapRow = screen.getByRole('checkbox', { name: 'Heatmap layer' }).closest('.layer-row')
    expect(heatmapRow.nextElementSibling).toHaveTextContent('NO AIRPORT DATA')
    expect(heatmapRow.nextElementSibling).not.toHaveTextContent('AWAITING AIRPORTS')
  })
})
