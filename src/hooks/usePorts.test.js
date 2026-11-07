import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
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
