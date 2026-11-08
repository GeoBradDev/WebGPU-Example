import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAirports } from './useAirports.js'
import { AIRPORTS_DATA_URL } from '../config/sources.js'

const DATA = {
  version: 1,
  types: ['large_airport', 'medium_airport', 'small_airport'],
  lon: [-118.4, -87.9, 20],
  lat: [33.9, 41.9, 10],
  name: ['LAX', 'ORD', 'Strip'],
  type: [0, 1, 2],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Issue #9: airports come from the committed same-origin JSON, not the CSV.
describe('useAirports data', () => {
  it('fetches the same-origin airports JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(DATA) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(AIRPORTS_DATA_URL).toBe('/data/airports.json')
    expect(fetchMock).toHaveBeenCalledWith(AIRPORTS_DATA_URL)
  })

  it('returns all included airports and the large plus medium subset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(DATA) }))
    const { result } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.airports.map((a) => a.name)).toEqual(['LAX', 'ORD', 'Strip'])
    expect(result.current.majorAirports.map((a) => a.name)).toEqual(['LAX', 'ORD'])
    expect(result.current.airports[0]).toEqual({ lon: -118.4, lat: 33.9, name: 'LAX', type: 'large_airport' })
  })

  it('keeps majorAirports referentially stable across renders of the same load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(DATA) }))
    const { result, rerender } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const first = result.current.majorAirports
    rerender()
    expect(result.current.majorAirports).toBe(first)
  })

  it('sets error, not loaded, when the body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ lon: [1] }) }))
    const { result } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.message).toBe('Airport data is malformed')
    expect(result.current.loaded).toBe(false)
    expect(result.current.airports).toEqual([])
    expect(result.current.majorAirports).toEqual([])
  })

  it('sets error when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
    const { result } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.message).toMatch(/404/)
  })
})

// Issue #10: a failed load can be retried without a page reload.
describe('useAirports retry', () => {
  const okResponse = () => ({ ok: true, json: () => Promise.resolve(DATA) })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears the error, goes back to loading, and refetches the same URL', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'))
    let release
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = r }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAirports())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loaded).toBe(false)

    act(() => result.current.retry())
    expect(result.current.error).toBeNull()
    expect(result.current.loaded).toBe(false)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(2, AIRPORTS_DATA_URL)

    await act(async () => release(okResponse()))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.error).toBeNull()
    expect(result.current.airports).toHaveLength(3)
  })

  it('keeps retry referentially stable across renders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(okResponse()))
    const { result } = renderHook(() => useAirports())
    const first = result.current.retry
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.retry).toBe(first)
  })

  it('never writes state from a request that was superseded by unmount', async () => {
    let release
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { release = r })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useAirports())
    const before = result.current
    unmount()
    await act(async () => release(okResponse()))
    expect(result.current).toBe(before)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
