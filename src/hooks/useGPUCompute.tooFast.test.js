import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGPUCompute, formatThroughput } from './useGPUCompute.js'

// Issue #11: a coarse performance.now() can make the median 0, which must not
// render as Infinity GB/s.

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

describe('formatThroughput with a non-positive or non-finite time', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('returns Too fast for %s seconds', (seconds) => {
    expect(formatThroughput(seconds)).toBe('Too fast')
  })
})

describe('useGPUCompute with zero timings', () => {
  it('shows Too fast when every dispatch times as 0', async () => {
    const mock = installGPU()
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(5)
    expect(result.current.throughput).toBe('Too fast')
  })
})
