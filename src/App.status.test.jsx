import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMapStore } from './store/mapStore.js'
import { OURAIRPORTS_CSV_URL, WORLD_PORTS_URL } from './config/sources.js'
import App from './App.jsx'

// Issue #10 reproduction: when the airports (or ports) fetch fails, the UI
// shows no error, the map is just empty, and the header still says
// SYS NOMINAL. The failure must be visible in the layer panel with a Retry
// that recovers without a page reload, and the header must say DEGRADED.

// jsdom has no WebGL or WebGPU: stub the map and the GPU heatmap hook. The
// heatmap stub behaves like the real hook: waiting with no airports, ready
// once airports are present.
vi.mock('./components/MapView.jsx', () => ({
  MapView: ({ layerData }) => (
    <div data-testid="map-view">
      airports:{layerData.airports.length} ports:{layerData.ports.length}
    </div>
  ),
}))

const heatmapRetry = vi.fn()
vi.mock('./hooks/useGPUHeatmap.js', () => ({
  useGPUHeatmap: (airports) =>
    airports.length > 0
      ? { canvas: 'data:image/png;base64,X', computeMs: 3, supported: true, error: null, status: 'ready', retry: heatmapRetry }
      : { canvas: null, computeMs: null, supported: true, error: null, status: 'waiting', retry: heatmapRetry },
}))

const CSV = 'id,ident,type,name,latitude_deg,longitude_deg\n1,KLAX,large_airport,LAX,33.9,-118.4\n'
const GEOJSON = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [4.4, 51.9] }, properties: { PORT_NAME: 'Rotterdam' } }],
}

const okCsv = () => Promise.resolve({ ok: true, text: () => Promise.resolve(CSV) })
const okJson = () => Promise.resolve({ ok: true, json: () => Promise.resolve(GEOJSON) })

function stubFetch({ airportsFail = 0, portsFail = 0 } = {}) {
  let airportCalls = 0
  let portCalls = 0
  const fetchMock = vi.fn((url) => {
    if (url === OURAIRPORTS_CSV_URL) {
      airportCalls++
      return airportCalls <= airportsFail ? Promise.reject(new TypeError('Failed to fetch')) : okCsv()
    }
    portCalls++
    return portCalls <= portsFail
      ? Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      : okJson()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const headerStatus = () => document.querySelector('.header-status')

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
  // MapView is stubbed, so play deck.gl's part: the render device is ready.
  useMapStore.setState({ render: { status: 'ready', type: 'webgl', renderer: 'Test' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App with a failed data load', () => {
  it('shows AIRPORTS LOAD FAILED with Retry and the header says DEGRADED, not NOMINAL', async () => {
    stubFetch({ airportsFail: 1 })
    render(<App />)

    await waitFor(() => expect(headerStatus()).toHaveTextContent('SYS DEGRADED'))
    expect(headerStatus()).not.toHaveTextContent('NOMINAL')

    const airportsRow = screen.getByRole('checkbox', { name: 'Airports layer' }).closest('.layer-row')
    expect(airportsRow.nextElementSibling).toHaveTextContent('LOAD FAILED')
    expect(screen.getByRole('button', { name: 'Retry Airports' })).toBeInTheDocument()
  })

  it('shows SEA PORTS LOAD FAILED with Retry and the header says DEGRADED', async () => {
    stubFetch({ portsFail: 1 })
    render(<App />)

    await waitFor(() => expect(headerStatus()).toHaveTextContent('SYS DEGRADED'))
    const portsRow = screen.getByRole('checkbox', { name: 'Sea Ports layer' }).closest('.layer-row')
    expect(portsRow.nextElementSibling).toHaveTextContent('LOAD FAILED')
    expect(screen.getByRole('button', { name: 'Retry Sea Ports' })).toBeInTheDocument()
  })

  it('recovers on Retry without a remount: count shown, header NOMINAL, focus on the checkbox', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch({ airportsFail: 1 })
    render(<App />)

    const retry = await screen.findByRole('button', { name: 'Retry Airports' })
    const mapBefore = screen.getByTestId('map-view')
    await user.click(retry)

    const airportsRow = screen.getByRole('checkbox', { name: 'Airports layer' }).closest('.layer-row')
    await waitFor(() => expect(airportsRow.nextElementSibling).toHaveTextContent('1 FEATURES'))
    await waitFor(() => expect(headerStatus()).toHaveTextContent('SYS NOMINAL'))
    expect(screen.queryByRole('button', { name: 'Retry Airports' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveFocus()

    expect(fetchMock.mock.calls.filter(([url]) => url === OURAIRPORTS_CSV_URL)).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => url === WORLD_PORTS_URL)).toHaveLength(1)
    expect(screen.getByTestId('map-view')).toBe(mapBefore)
    expect(mapBefore).toHaveTextContent('airports:1 ports:1')
  })
})
