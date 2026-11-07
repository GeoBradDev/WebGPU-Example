import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGPUCapabilities } from './useGPUCapabilities.js'

function stubGPU(gpu) {
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true, writable: true })
}

afterEach(() => {
  delete navigator.gpu
})

describe('useGPUCapabilities', () => {
  it('starts in the unknown tier', () => {
    stubGPU(undefined)
    const { result } = renderHook(() => useGPUCapabilities())
    expect(result.current).toEqual({ tier: 'unknown', adapterInfo: {} })
  })

  it('reports no-webgpu when navigator.gpu is absent', async () => {
    stubGPU(undefined)
    const { result } = renderHook(() => useGPUCapabilities())
    await waitFor(() => expect(result.current.tier).toBe('no-webgpu'))
    expect(result.current.adapterInfo).toEqual({})
  })

  it('reports no-webgpu when requestAdapter resolves null', async () => {
    stubGPU({ requestAdapter: vi.fn().mockResolvedValue(null) })
    const { result } = renderHook(() => useGPUCapabilities())
    await waitFor(() => expect(result.current.tier).toBe('no-webgpu'))
    expect(result.current.adapterInfo).toEqual({})
  })

  it('reports no-webgpu when requestAdapter rejects', async () => {
    stubGPU({ requestAdapter: vi.fn().mockRejectedValue(new Error('denied')) })
    const { result } = renderHook(() => useGPUCapabilities())
    await waitFor(() => expect(result.current.tier).toBe('no-webgpu'))
  })

  it('reports webgpu with adapter.info when an adapter is available', async () => {
    const info = { vendor: 'acme', architecture: 'rdna3', device: 'Test GPU' }
    stubGPU({ requestAdapter: vi.fn().mockResolvedValue({ info }) })
    const { result } = renderHook(() => useGPUCapabilities())
    await waitFor(() => expect(result.current.tier).toBe('webgpu'))
    expect(result.current.adapterInfo).toEqual(info)
  })
})
