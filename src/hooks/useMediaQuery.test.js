import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery, NARROW_QUERY } from './useMediaQuery.js'

function mockMatchMedia(initial) {
  const listeners = new Set()
  const state = { matches: initial }
  const mql = {
    get matches() {
      return state.matches
    },
    media: '',
    addEventListener: vi.fn((type, cb) => {
      if (type === 'change') listeners.add(cb)
    }),
    removeEventListener: vi.fn((type, cb) => {
      if (type === 'change') listeners.delete(cb)
    }),
  }
  const matchMedia = vi.fn((query) => {
    mql.media = query
    return mql
  })
  return {
    matchMedia,
    mql,
    listeners,
    fire(matches) {
      state.matches = matches
      listeners.forEach((cb) => cb({ matches, media: mql.media }))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('treats narrow widths and short landscape phones, not short desktop windows, as narrow', () => {
    expect(NARROW_QUERY).toBe('(max-width: 640px), (max-width: 1024px) and (max-height: 500px)')
  })

  it('returns false when matchMedia is not available', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useMediaQuery(NARROW_QUERY))
    expect(result.current).toBe(false)
  })

  it('returns the matches value from matchMedia', () => {
    const mock = mockMatchMedia(true)
    vi.stubGlobal('matchMedia', mock.matchMedia)
    const { result } = renderHook(() => useMediaQuery(NARROW_QUERY))
    expect(result.current).toBe(true)
    expect(mock.matchMedia).toHaveBeenCalledWith(NARROW_QUERY)
  })

  it('updates when the media query fires change', () => {
    const mock = mockMatchMedia(false)
    vi.stubGlobal('matchMedia', mock.matchMedia)
    const { result } = renderHook(() => useMediaQuery(NARROW_QUERY))
    expect(result.current).toBe(false)
    act(() => mock.fire(true))
    expect(result.current).toBe(true)
    act(() => mock.fire(false))
    expect(result.current).toBe(false)
  })

  it('removes its change listener on unmount', () => {
    const mock = mockMatchMedia(false)
    vi.stubGlobal('matchMedia', mock.matchMedia)
    const { unmount } = renderHook(() => useMediaQuery(NARROW_QUERY))
    expect(mock.listeners.size).toBe(1)
    unmount()
    expect(mock.listeners.size).toBe(0)
    expect(mock.mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
