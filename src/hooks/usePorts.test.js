import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePorts } from './usePorts.js'
import { WORLD_PORTS_URL } from '../config/sources.js'

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [4.4, 51.9] }, properties: { PORT_NAME: 'Rotterdam' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [103.8, 1.26] }, properties: { name: 'Singapore' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { PORT_NAME: 'Not a point' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 10] }, properties: { PORT_NAME: 'Bad coords' } },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePorts', () => {
  it('fetches the bundled GeoJSON and parses Point features with finite coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(GEOJSON) })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePorts())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    expect(fetchMock).toHaveBeenCalledWith(WORLD_PORTS_URL)
    expect(result.current.error).toBeNull()
    expect(result.current.ports).toEqual([
      { lon: 4.4, lat: 51.9, name: 'Rotterdam' },
      { lon: 103.8, lat: 1.26, name: 'Singapore' },
    ])
  })

  it('reports an error and stays unloaded when the response is not OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))

    const { result } = renderHook(() => usePorts())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.error.message).toBe('Ports fetch failed: 404 Not Found')
    expect(result.current.loaded).toBe(false)
    expect(result.current.ports).toEqual([])
  })

  it('reports an error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { result } = renderHook(() => usePorts())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.error.message).toBe('network down')
    expect(result.current.loaded).toBe(false)
    expect(result.current.ports).toEqual([])
  })
})

// Issue #10: a failed load can be retried without a page reload.
describe('usePorts retry', () => {
  const okResponse = () => ({ ok: true, json: () => Promise.resolve(GEOJSON) })

  it('clears the error, goes back to loading, and refetches the same URL', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
    let release
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = r }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePorts())
    await waitFor(() => expect(result.current.error).not.toBeNull())

    act(() => result.current.retry())
    expect(result.current.error).toBeNull()
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(2, WORLD_PORTS_URL)

    await act(async () => release(okResponse()))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.ports).toHaveLength(2)
  })

  it('keeps retry referentially stable across renders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(okResponse()))
    const { result } = renderHook(() => usePorts())
    const first = result.current.retry
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.retry).toBe(first)
  })

  it('ignores a request superseded by a retry', async () => {
    const releases = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => releases.push(r))))
    const { result } = renderHook(() => usePorts())
    // Retry while the first request is still in flight.
    act(() => result.current.retry())
    await waitFor(() => expect(releases).toHaveLength(2))
    await act(async () => releases[0]({ ok: false, status: 503, statusText: 'Stale' }))
    expect(result.current.error).toBeNull()
    await act(async () => releases[1](okResponse()))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.error).toBeNull()
  })
})
