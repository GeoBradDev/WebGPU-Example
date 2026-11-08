import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useGPUHeatmap } from './useGPUHeatmap.js'

// Issue #10 review finding B: navigator.gpu can exist while requestAdapter()
// resolves null (stock Linux Chrome). The heatmap only asked for an adapter
// once airports were non-empty, so with airports failed or empty it stayed
// waiting forever instead of unsupported. The adapter must be probed at
// mount, independent of airports; null or a throw means unsupported.

function installGPU(requestAdapter) {
  const gpu = { requestAdapter: vi.fn(requestAdapter) }
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu })
  return gpu
}

afterEach(() => {
  delete navigator.gpu
  vi.restoreAllMocks()
})

describe('useGPUHeatmap adapter probe', () => {
  it('is unsupported when requestAdapter resolves null, even with no airports', async () => {
    installGPU(async () => null)
    const { result } = renderHook(() => useGPUHeatmap([]))
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.supported).toBe(false)
  })

  it('is unsupported when requestAdapter throws, even with no airports', async () => {
    installGPU(async () => {
      throw new Error('adapter request failed')
    })
    const { result } = renderHook(() => useGPUHeatmap([]))
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.supported).toBe(false)
  })

  it('stays unsupported after retry', async () => {
    installGPU(async () => null)
    const { result } = renderHook(() => useGPUHeatmap([]))
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    act(() => result.current.retry())
    expect(result.current.status).toBe('unsupported')
    expect(result.current.supported).toBe(false)
  })

  it('keeps waiting when the probe finds an adapter and airports are empty', async () => {
    const gpu = installGPU(async () => ({ requestDevice: vi.fn() }))
    const { result } = renderHook(() => useGPUHeatmap([]))
    await waitFor(() => expect(gpu.requestAdapter).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.status).toBe('waiting')
    expect(result.current.supported).toBe(true)
  })
})
