import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStressPoints } from './useStressPoints.js'

const DELAY = 150

describe('useStressPoints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns empty object when count is 0', () => {
    const { result } = renderHook(() => useStressPoints(0))
    expect(result.current.stressPoints).toEqual({})
    act(() => { vi.advanceTimersByTime(DELAY) })
    expect(result.current.stressPoints).toEqual({})
  })

  it('does not generate points during render, only after the debounce delay', () => {
    const randomSpy = vi.spyOn(Math, 'random')
    const { result } = renderHook(() => useStressPoints(100))
    expect(randomSpy).not.toHaveBeenCalled()
    expect(result.current.stressPoints).toEqual({})

    act(() => { vi.advanceTimersByTime(DELAY - 1) })
    expect(randomSpy).not.toHaveBeenCalled()
    expect(result.current.stressPoints).toEqual({})

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.stressPoints.length).toBe(100)
  })

  it('generates once, for the last count only, when count changes rapidly', () => {
    const randomSpy = vi.spyOn(Math, 'random')
    const { result, rerender } = renderHook(({ count }) => useStressPoints(count), {
      initialProps: { count: 10 },
    })
    act(() => { vi.advanceTimersByTime(50) })
    rerender({ count: 20 })
    act(() => { vi.advanceTimersByTime(50) })
    rerender({ count: 30 })
    expect(randomSpy).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(DELAY) })
    expect(result.current.stressPoints.length).toBe(30)
    // two Math.random calls (lon, lat) per point, for one generation of 30
    expect(randomSpy).toHaveBeenCalledTimes(60)
  })

  it('clears to the empty object after the debounce when count returns to 0', () => {
    const { result, rerender } = renderHook(({ count }) => useStressPoints(count), {
      initialProps: { count: 50 },
    })
    act(() => { vi.advanceTimersByTime(DELAY) })
    expect(result.current.stressPoints.length).toBe(50)

    rerender({ count: 0 })
    act(() => { vi.advanceTimersByTime(DELAY) })
    expect(result.current.stressPoints).toEqual({})
  })

  it('returns a binary columnar Float32Array with count * 3 values', () => {
    const { result } = renderHook(() => useStressPoints(100))
    act(() => { vi.advanceTimersByTime(DELAY) })
    const { value, size } = result.current.stressPoints.attributes.getPosition
    expect(value).toBeInstanceOf(Float32Array)
    expect(value.length).toBe(300)
    expect(size).toBe(3)
  })

  it('keeps lon within -180 to 180, lat within -85 to 85, alt at 0', () => {
    const { result } = renderHook(() => useStressPoints(500))
    act(() => { vi.advanceTimersByTime(DELAY) })
    const { value } = result.current.stressPoints.attributes.getPosition
    for (let i = 0; i < value.length; i += 3) {
      expect(value[i]).toBeGreaterThanOrEqual(-180)
      expect(value[i]).toBeLessThanOrEqual(180)
      expect(value[i + 1]).toBeGreaterThanOrEqual(-85)
      expect(value[i + 1]).toBeLessThanOrEqual(85)
      expect(value[i + 2]).toBe(0)
    }
  })
})
