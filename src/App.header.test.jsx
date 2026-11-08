import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { useMapStore } from './store/mapStore.js'
import { AIRPORTS_DATA_URL } from './config/sources.js'
import App from './App.jsx'

// Issue #10: header status markup and the App wiring of heatmap, render, and
// basemap health. jsdom has no WebGL or WebGPU: stub the map and the heatmap.
vi.mock('./components/MapView.jsx', () => ({ MapView: () => <div data-testid="map-view" /> }))

const heatmapState = vi.hoisted(() => ({ current: null }))
vi.mock('./hooks/useGPUHeatmap.js', () => ({ useGPUHeatmap: () => heatmapState.current }))

const READY = { canvas: 'data:,', computeMs: 3, supported: true, error: null, status: 'ready', retry: () => {} }
const AIRPORTS = {
  version: 1,
  types: ['large_airport', 'medium_airport', 'small_airport'],
  lon: [-118.4],
  lat: [33.9],
  name: ['LAX'],
  type: [0],
}
const GEOJSON = { type: 'FeatureCollection', features: [] }

function stubFetch({ airportsFail = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (url === AIRPORTS_DATA_URL) {
        return airportsFail
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve(AIRPORTS) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GEOJSON) })
    })
  )
}

const headerStatus = () => document.querySelector('.header-status')
const level = () => headerStatus().querySelector('.ok, .warn, .err')

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
  useMapStore.setState({ render: { status: 'ready', type: 'webgl', renderer: 'Test' } })
  heatmapState.current = READY
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App header status', () => {
  it('is a polite status region', () => {
    stubFetch()
    render(<App />)
    expect(headerStatus()).toHaveAttribute('role', 'status')
    expect(headerStatus()).toHaveAttribute('aria-live', 'polite')
  })

  it('shows LOADING with the warn class while data is in flight', () => {
    stubFetch()
    render(<App />)
    expect(level()).toHaveTextContent('LOADING')
    expect(level()).toHaveClass('warn')
  })

  it('shows NOMINAL with the ok class and no issues once everything is ready', async () => {
    stubFetch()
    render(<App />)
    await waitFor(() => expect(level()).toHaveTextContent('NOMINAL'))
    expect(level()).toHaveClass('ok')
    expect(headerStatus().querySelector('.visually-hidden')).toBeNull()
    expect(headerStatus()).not.toHaveAttribute('title')
  })

  it('shows DEGRADED with the err class, hidden issues text, and an issues title', async () => {
    stubFetch({ airportsFail: true })
    useMapStore.setState({ basemapFailed: true })
    render(<App />)
    await waitFor(() => expect(level()).toHaveTextContent('DEGRADED'))
    expect(level()).toHaveClass('err')
    expect(headerStatus().querySelector('.visually-hidden')).toHaveTextContent(': AIRPORTS FAILED, BASEMAP FAILED')
    expect(headerStatus()).toHaveAttribute('title', 'AIRPORTS FAILED, BASEMAP FAILED')
  })

  it('goes DEGRADED when the render device is lost', async () => {
    stubFetch()
    render(<App />)
    await waitFor(() => expect(level()).toHaveTextContent('NOMINAL'))
    act(() => useMapStore.setState({ render: { status: 'lost', type: 'webgl', renderer: 'Test' } }))
    expect(level()).toHaveTextContent('DEGRADED')
    expect(headerStatus()).toHaveAttribute('title', 'RENDER LOST')
  })
})

describe('App heatmap wiring', () => {
  it('shows NO AIRPORT DATA for the heatmap when airports failed', async () => {
    stubFetch({ airportsFail: true })
    heatmapState.current = { ...READY, canvas: null, computeMs: null, status: 'waiting' }
    render(<App />)
    const heatmapRow = screen.getByRole('checkbox', { name: 'Heatmap layer' }).closest('.layer-row')
    await waitFor(() => expect(heatmapRow.nextElementSibling).toHaveTextContent('NO AIRPORT DATA'))
    expect(headerStatus()).toHaveAttribute('title', 'AIRPORTS FAILED')
  })

  it('shows the WebGPU note and DEGRADED when the heatmap is unsupported', async () => {
    stubFetch()
    heatmapState.current = { ...READY, canvas: null, computeMs: null, supported: false, status: 'unsupported' }
    render(<App />)
    expect(screen.getByText('WEBGPU UNAVAILABLE: HEATMAP AND COMPUTE BENCHMARK OFF')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Heatmap layer' })).not.toBeInTheDocument()
    await waitFor(() => expect(headerStatus()).toHaveAttribute('title', 'WEBGPU UNAVAILABLE'))
    expect(level()).toHaveTextContent('DEGRADED')
  })

  it('wires the heatmap Retry button to the hook retry', async () => {
    stubFetch()
    const retry = vi.fn()
    heatmapState.current = { ...READY, canvas: null, computeMs: null, status: 'error', error: new Error('bad'), retry }
    render(<App />)
    screen.getByRole('button', { name: 'Retry Heatmap' }).click()
    expect(retry).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(headerStatus()).toHaveAttribute('title', 'HEATMAP FAILED'))
  })
})
