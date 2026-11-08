import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGPUCompute, BENCHMARK_DISPATCHES } from './useGPUCompute.js'

// Issue #11: a device loss that is only recorded after the loop (while the error
// scopes are being popped, or after a hide ended the loop) must still show Failed.

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Self-contained WebGPU mock. Each async step can be held open with a deferred.
function installGPU({ holdAdapter = false, holdDevice = false, holdWork = false, holdPop = false, popError = null, lost = null } = {}) {
  const adapterGate = deferred()
  const deviceGate = deferred()
  const popGate = deferred()
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
    popErrorScope: vi.fn(async () => {
      if (holdPop) await popGate.promise
      return popError
    }),
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
  return { gpu, gpuAdapter, device, buffer, queue, pending, adapterGate, deviceGate, popGate }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function hide() {
  setVisibility('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  delete navigator.gpu
  delete document.visibilityState
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useGPUCompute device loss recorded after the dispatch loop', () => {
  it('shows Failed when device.lost resolves while the error scopes are being popped', async () => {
    const lost = deferred()
    const mock = installGPU({ holdWork: true, holdPop: true, lost })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    for (let k = 0; k < BENCHMARK_DISPATCHES; k++) {
      await waitFor(() => expect(mock.pending.length).toBe(k + 1))
      await act(async () => {
        mock.pending[k].resolve()
      })
    }
    await waitFor(() => expect(mock.device.popErrorScope).toHaveBeenCalled())
    await act(async () => {
      lost.resolve({ reason: 'unknown', message: 'GPU reset' })
    })
    await act(async () => {
      mock.popGate.resolve()
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(BENCHMARK_DISPATCHES)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Failed')
  })

  it('shows Failed, not Stopped, when the tab is hidden and the device is lost mid-run', async () => {
    const lost = deferred()
    const mock = installGPU({ holdWork: true, lost })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.pending.length).toBe(1))
    await act(async () => {
      mock.pending[0].resolve()
    })
    await waitFor(() => expect(mock.pending.length).toBe(2))
    act(() => hide())
    await act(async () => {
      lost.resolve({ reason: 'unknown', message: 'GPU reset' })
      mock.pending[1].resolve()
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(2)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Failed')
  })
})
