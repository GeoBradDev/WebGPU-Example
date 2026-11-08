import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGPUCompute, median, formatThroughput, BENCHMARK_DISPATCHES } from './useGPUCompute.js'

describe('useGPUCompute', () => {
  it('returns supported: false and throughput: "--" when navigator.gpu is undefined', () => {
    // jsdom does not implement navigator.gpu, so this tests the fallback path
    const { result } = renderHook(() => useGPUCompute())
    expect(result.current.supported).toBe(false)
    expect(result.current.throughput).toBe('--')
  })
})

describe('median', () => {
  it('returns the middle value of an odd-length list', () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3)
  })

  it('returns the mean of the two middle values of an even-length list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('does not reorder its input', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })
})

describe('formatThroughput', () => {
  it('formats 128 MB over the elapsed seconds as an estimate in GB/s', () => {
    expect(formatThroughput(0.1)).toBe('~1.3 GB/s est.')
    expect(formatThroughput(0.001)).toBe('~128.0 GB/s est.')
  })
})

// ─── Mocked WebGPU ───

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function installGPU({ adapter = true, failPipeline = false } = {}) {
  const pending = []
  const buffer = {
    getMappedRange: vi.fn(() => new ArrayBuffer(16)),
    unmap: vi.fn(),
    destroy: vi.fn(),
  }
  const queue = {
    submit: vi.fn(),
    onSubmittedWorkDone: vi.fn(() => {
      const d = deferred()
      pending.push(d)
      return d.promise
    }),
  }
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  }
  const device = {
    queue,
    createBuffer: vi.fn(() => buffer),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => {
      if (failPipeline) throw new Error('pipeline failed')
      return { getBindGroupLayout: () => ({}) }
    }),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: () => pass,
      finish: () => ({}),
    })),
    destroy: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    lost: new Promise(() => {}),
  }
  const gpuAdapter = { requestDevice: vi.fn(async () => device) }
  const gpu = { requestAdapter: vi.fn(async () => (adapter ? gpuAdapter : null)) }
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu })
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128 })
  return { gpu, gpuAdapter, device, buffer, queue, pending }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

afterEach(() => {
  delete navigator.gpu
  delete document.visibilityState
  vi.unstubAllGlobals()
})

async function resolveDispatch(mock, k) {
  await waitFor(() => expect(mock.queue.submit).toHaveBeenCalledTimes(k + 1))
  await waitFor(() => expect(mock.pending.length).toBe(k + 1))
  await act(async () => {
    mock.pending[k].resolve()
  })
}

describe('useGPUCompute with WebGPU', () => {
  it('does no GPU work on mount', () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUCompute())
    expect(mock.gpu.requestAdapter).not.toHaveBeenCalled()
    expect(mock.gpuAdapter.requestDevice).not.toHaveBeenCalled()
    expect(mock.device.createBuffer).not.toHaveBeenCalled()
    expect(mock.queue.submit).not.toHaveBeenCalled()
    expect(result.current.supported).toBe(true)
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('--')
  })

  it('runs the dispatches strictly in sequence and reports the estimate', async () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    expect(result.current.running).toBe(true)
    expect(result.current.throughput).toBe('Running...')

    for (let k = 0; k < BENCHMARK_DISPATCHES; k++) {
      await waitFor(() => expect(mock.queue.submit).toHaveBeenCalledTimes(k + 1))
      // The next dispatch must wait for this one to finish.
      await act(async () => {})
      expect(mock.queue.submit).toHaveBeenCalledTimes(k + 1)
      await act(async () => {
        mock.pending[k].resolve()
      })
    }
    await act(async () => {
      await done
    })

    expect(mock.gpu.requestAdapter).toHaveBeenCalledTimes(1)
    expect(mock.gpuAdapter.requestDevice).toHaveBeenCalledTimes(1)
    expect(mock.device.createBuffer).toHaveBeenCalledTimes(1)
    expect(mock.queue.submit).toHaveBeenCalledTimes(BENCHMARK_DISPATCHES)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toMatch(/^~\d+\.\d GB\/s est\.$/)
  })

  it('schedules nothing after a run', async () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    for (let k = 0; k < BENCHMARK_DISPATCHES; k++) await resolveDispatch(mock, k)
    await act(async () => {
      await done
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100))
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(BENCHMARK_DISPATCHES)
  })

  it('does nothing when activated while the document is hidden', async () => {
    const mock = installGPU()
    setVisibility('hidden')
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.gpu.requestAdapter).not.toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('--')
  })

  it('stops before the next dispatch when the tab is hidden mid-run', async () => {
    const mock = installGPU()
    setVisibility('visible')
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.queue.submit).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      mock.pending[0].resolve()
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(1)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Stopped')
  })

  it('ignores activation while a run is in progress', async () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await act(async () => {
      await result.current.run()
    })
    for (let k = 0; k < BENCHMARK_DISPATCHES; k++) await resolveDispatch(mock, k)
    await act(async () => {
      await done
    })
    expect(mock.gpu.requestAdapter).toHaveBeenCalledTimes(1)
    expect(mock.queue.submit).toHaveBeenCalledTimes(BENCHMARK_DISPATCHES)
  })

  it('keeps run stable across renders', async () => {
    installGPU()
    const { result, rerender } = renderHook(() => useGPUCompute())
    const first = result.current.run
    rerender()
    expect(result.current.run).toBe(first)
  })

  it('stops and destroys on unmount mid-run', async () => {
    const mock = installGPU()
    const { result, unmount } = renderHook(() => useGPUCompute())
    let done
    act(() => {
      done = result.current.run()
    })
    await waitFor(() => expect(mock.queue.submit).toHaveBeenCalledTimes(1))
    unmount()
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    await act(async () => {
      mock.pending[0].resolve()
      await done
    })
    expect(mock.queue.submit).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported when requestAdapter returns null', async () => {
    const mock = installGPU({ adapter: false })
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.gpu.requestAdapter).toHaveBeenCalledTimes(1)
    expect(result.current.supported).toBe(false)
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('--')
  })

  it('shows Failed and destroys what it allocated when a run throws', async () => {
    const mock = installGPU({ failPipeline: true })
    const { result } = renderHook(() => useGPUCompute())
    await act(async () => {
      await result.current.run()
    })
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
    expect(mock.queue.submit).not.toHaveBeenCalled()
    expect(result.current.supported).toBe(true)
    expect(result.current.running).toBe(false)
    expect(result.current.throughput).toBe('Failed')
  })
})
