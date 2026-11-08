import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGPUCompute } from './useGPUCompute.js'

// Issue #11: a stop (hidden tab or unmount) during adapter or device setup must
// bail before the 64 MB buffer is allocated, and run() after unmount does nothing.

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

describe('useGPUCompute stop during setup', () => {
  it('stops before allocating when hidden while requestAdapter is pending', async () => {
    const mock = installGPU({ holdAdapter: true })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.gpu.requestAdapter).toHaveBeenCalled())
    act(() => hide())
    await act(async () => {
      mock.adapterGate.resolve()
      await done
    })
    expect(mock.device.createBuffer).not.toHaveBeenCalled()
    expect(mock.queue.submit).not.toHaveBeenCalled()
    if (mock.gpuAdapter.requestDevice.mock.calls.length) expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Stopped')
  })

  it('stops before allocating and destroys the device when hidden while requestDevice is pending', async () => {
    const mock = installGPU({ holdDevice: true })
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.gpuAdapter.requestDevice).toHaveBeenCalled())
    act(() => hide())
    await act(async () => {
      mock.deviceGate.resolve()
      await done
    })
    expect(mock.device.createBuffer).not.toHaveBeenCalled()
    expect(mock.queue.submit).not.toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Stopped')
  })

  it('does not allocate and destroys the device when unmounted while requestDevice is pending', async () => {
    const mock = installGPU({ holdDevice: true })
    const { result, unmount } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.gpuAdapter.requestDevice).toHaveBeenCalled())
    unmount()
    await act(async () => {
      mock.deviceGate.resolve()
      await done
    })
    expect(mock.device.createBuffer).not.toHaveBeenCalled()
    expect(mock.queue.submit).not.toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
  })

  it('does nothing when run() is called after unmount', async () => {
    const mock = installGPU()
    const { result, unmount } = renderHook(() => useGPUCompute())
    const run = result.current.run
    unmount()
    await act(async () => {
      await run()
    })
    expect(mock.gpu.requestAdapter).not.toHaveBeenCalled()
    expect(mock.device.createBuffer).not.toHaveBeenCalled()
  })
})
