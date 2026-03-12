import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStressPoints } from './useStressPoints.js'

describe('useStressPoints', () => {
  it('returns empty object when count is 0', () => {
    const { result } = renderHook(() => useStressPoints(0))
    expect(result.current.stressPoints).toEqual({})
  })

  it('returns binary columnar object with correct length', () => {
    const { result } = renderHook(() => useStressPoints(100))
    expect(result.current.stressPoints.length).toBe(100)
  })

  it('returns Float32Array with count * 3 values', () => {
    const { result } = renderHook(() => useStressPoints(100))
    const { value, size } = result.current.stressPoints.attributes.getPosition
    expect(value).toBeInstanceOf(Float32Array)
    expect(value.length).toBe(300)
    expect(size).toBe(3)
  })

  it('longitude values are within -180 to 180', () => {
    const { result } = renderHook(() => useStressPoints(500))
    const { value } = result.current.stressPoints.attributes.getPosition
    for (let i = 0; i < value.length; i += 3) {
      expect(value[i]).toBeGreaterThanOrEqual(-180)
      expect(value[i]).toBeLessThanOrEqual(180)
    }
  })

  it('latitude values are within -85 to 85', () => {
    const { result } = renderHook(() => useStressPoints(500))
    const { value } = result.current.stressPoints.attributes.getPosition
    for (let i = 1; i < value.length; i += 3) {
      expect(value[i]).toBeGreaterThanOrEqual(-85)
      expect(value[i]).toBeLessThanOrEqual(85)
    }
  })
})