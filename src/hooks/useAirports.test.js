import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { parseAirportCSV, useAirports } from './useAirports.js'
import { OURAIRPORTS_CSV_URL } from '../config/sources.js'

const SAMPLE_CSV = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent',
  '1,KLAX,large_airport,Los Angeles International Airport,33.9425,-118.4081,125,NA',
  '2,KSFO,large_airport,San Francisco International Airport,37.6188,-122.3750,13,NA',
  '3,ZZZZ,closed,Closed Airport,0.0,0.0,0,NA',
  '4,KABC,small_airport,"City of, State Airport",10.0,20.0,100,NA',
].join('\n')

describe('parseAirportCSV', () => {
  it('returns an array', () => {
    expect(Array.isArray(parseAirportCSV(SAMPLE_CSV))).toBe(true)
  })

  it('filters out closed airports', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result.every((a) => a.type !== 'closed')).toBe(true)
  })

  it('parses lon and lat as numbers', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].lon).toBe(-118.4081)
    expect(result[0].lat).toBe(33.9425)
  })

  it('parses name and type strings', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].name).toBe('Los Angeles International Airport')
    expect(result[0].type).toBe('large_airport')
  })

  it('handles quoted names with embedded commas', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    const quoted = result.find((a) => a.name === 'City of, State Airport')
    expect(quoted).toBeDefined()
  })

  it('handles RFC 4180 doubled-quote escape inside quoted field', () => {
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft',
      '1,KORD,large_airport,"O""Hare International",41.9786,-87.9048,668',
    ].join('\n')
    const result = parseAirportCSV(csv)
    expect(result[0].name).toBe('O"Hare International')
  })

  it('filters rows with invalid lon/lat', () => {
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft',
      '1,XBAD,small_airport,Bad Airport,,20.0,0',
    ].join('\n')
    const result = parseAirportCSV(csv)
    expect(result).toHaveLength(0)
  })
})

// Issue #10: a failed load can be retried without a page reload.
describe('useAirports retry', () => {
  const CSV = 'id,ident,type,name,latitude_deg,longitude_deg\n1,KLAX,large_airport,LAX,33.9,-118.4\n'
  const okResponse = () => ({ ok: true, text: () => Promise.resolve(CSV) })

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
    expect(fetchMock).toHaveBeenNthCalledWith(2, OURAIRPORTS_CSV_URL)

    await act(async () => release(okResponse()))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.error).toBeNull()
    expect(result.current.airports).toHaveLength(1)
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
