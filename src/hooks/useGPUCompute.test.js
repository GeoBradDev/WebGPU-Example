import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGPUCompute } from './useGPUCompute.js'

describe('useGPUCompute', () => {
  it('returns supported: false and throughput: "--" when navigator.gpu is undefined', () => {
    // jsdom does not implement navigator.gpu, so this tests the fallback path
    const { result } = renderHook(() => useGPUCompute())
    expect(result.current.supported).toBe(false)
    expect(result.current.throughput).toBe('--')
  })
})
