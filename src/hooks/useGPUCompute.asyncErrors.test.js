import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGPUCompute } from './useGPUCompute.js'

// Issue #11: WebGPU reports out-of-memory and validation errors asynchronously
// through error scopes, and device loss through device.lost. Either must show
// Failed, not a bogus GB/s.

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Self-contained WebGPU mock. Each async step can be held open with a deferred.
function installGPU({ holdAdapter = false, holdDevice = false, holdWork = false, popError = null, lost = null } = {}) {
  const adapterGate = deferred()
  const deviceGate = deferred()
  const pending = []
  const buffer = { getMappedRange: vi.fn(() => new ArrayBuffer(16)), unmap: vi.fn(), destroy: vi.fn() }
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() }
  const queue = {
    submit: vi.fn(),
    onSubmittedWorkDone: vi.fn(() => {
      const d = deferred()
      pending.push(d)
      if (!holdWork) d.resolve()
      return d.promise
    }),
  }
  const device = {
    queue,
    createBuffer: vi.fn(() => buffer),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({ beginComputePass: () => pass, finish: () => ({}) })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => popError),
    lost: lost ? lost.promise : new Promise(() => {}),
    destroy: vi.fn(),
  }
  const gpuAdapter = {
    requestDevice: vi.fn(async () => {
      if (holdDevice) await deviceGate.promise
      return device
    }),
  }
  const gpu = {
    requestAdapter: vi.fn(async () => {
      if (holdAdapter) await adapterGate.promise
      return gpuAdapter
    }),
  }
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu })
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128 })
  return { gpu, gpuAdapter, device, buffer, queue, pending, adapterGate, deviceGate }
}

afterEach(() => {
  delete navigator.gpu
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useGPUCompute async GPU errors', () => {
  it('shows Failed and destroys resources when an error scope reports an error', async () => {
    const mock = installGPU({ popError: { message: 'Out of memory' } })
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.device.pushErrorScope).toHaveBeenCalledWith('out-of-memory')
    expect(mock.device.pushErrorScope).toHaveBeenCalledWith('validation')
    expect(mock.device.popErrorScope).toHaveBeenCalledTimes(2)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Failed')
  })

  it('shows a result when both error scopes are clean', async () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.device.popErrorScope).toHaveBeenCalledTimes(2)
    expect(result.current.throughput).not.toBe('Failed')
  })

  it('shows Failed when the device is lost mid-run while the work never completes', async () => {
    const lost = deferred()
    const mock = installGPU({ holdWork: true, lost })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.queue.submit).toHaveBeenCalledTimes(1))
    await act(async () => {
      lost.resolve({ reason: 'unknown', message: 'GPU reset' })
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(1)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Failed')
  })
})
