import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGPUHeatmap, buildPointsData } from './useGPUHeatmap.js'

describe('buildPointsData', () => {
  it('returns a Float32Array of length airportCount * 2', () => {
    const airports = [
      { lon: 10, lat: 20 },
      { lon: -75, lat: 40 },
    ]
    const result = buildPointsData(airports)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(4)
  })

  it('packs lon first then lat for each point', () => {
    const airports = [{ lon: 12.5, lat: -33.9 }]
    const result = buildPointsData(airports)
    expect(result[0]).toBeCloseTo(12.5)
    expect(result[1]).toBeCloseTo(-33.9)
  })

  it('returns empty Float32Array for empty input', () => {
    const result = buildPointsData([])
    expect(result.length).toBe(0)
  })
})

describe('useGPUHeatmap', () => {
  it('returns supported: false and canvas: null when navigator.gpu is undefined', () => {
    // jsdom does not implement navigator.gpu - tests the fallback path
    const airports = [{ lon: 10, lat: 20, name: 'Test', type: 'large_airport' }]
    const { result } = renderHook(() => useGPUHeatmap(airports))
    expect(result.current.supported).toBe(false)
    expect(result.current.canvas).toBeNull()
  })

  it('returns computeMs: null before compute completes', () => {
    const airports = [{ lon: 10, lat: 20, name: 'Test', type: 'large_airport' }]
    const { result } = renderHook(() => useGPUHeatmap(airports))
    expect(result.current.computeMs).toBeNull()
  })

  it('does not throw when airports array is empty', () => {
    expect(() => renderHook(() => useGPUHeatmap([]))).not.toThrow()
  })
})