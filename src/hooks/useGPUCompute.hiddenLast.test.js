import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGPUCompute, BENCHMARK_DISPATCHES } from './useGPUCompute.js'

// Issue #11: a hide that arrives while the last dispatch is in flight lets that
// dispatch finish, so all timings are in and the result must be shown.

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

describe('useGPUCompute hidden during the last dispatch', () => {
  it('shows the result, not Stopped, when every dispatch completed', async () => {
    const mock = installGPU({ holdWork: true })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    for (let k = 0; k < BENCHMARK_DISPATCHES; k++) {
      await waitFor(() => expect(mock.pending.length).toBe(k + 1))
      if (k === BENCHMARK_DISPATCHES - 1) act(() => hide())
      await act(async () => {
        mock.pending[k].resolve()
      })
    }
    await act(async () => {
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(BENCHMARK_DISPATCHES)
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toMatch(/^~\d+\.\d GB\/s est\.$|^Too fast$/)
  })
})
