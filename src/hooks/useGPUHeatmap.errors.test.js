import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useGPUHeatmap } from './useGPUHeatmap.js'

// Issue #10: heatmap status model. A fake WebGPU device stands in for the GPU;
// each test chooses what the adapter, error scopes, and lost promise do.

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function installGPU({ adapterNull = false, popErrors = [], lost = null, failCreate = null, holdMap = false } = {}) {
  const mapGate = deferred()
  const buffer = {
    mapAsync: vi.fn(async () => {
      if (holdMap) await mapGate.promise
    }),
    getMappedRange: vi.fn(() => new ArrayBuffer(16)),
    unmap: vi.fn(),
    destroy: vi.fn(),
  }
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() }
  const popErrorScope = vi.fn()
  for (const e of popErrors) popErrorScope.mockResolvedValueOnce(e)
  popErrorScope.mockResolvedValue(null)
  const device = {
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    createBuffer: vi.fn(() => buffer),
    createShaderModule: vi.fn(() => {
      if (failCreate) throw failCreate
      return {}
    }),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: () => pass,
      copyBufferToBuffer: vi.fn(),
      finish: () => ({}),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope,
    lost: lost ? lost.promise : new Promise(() => {}),
    destroy: vi.fn(),
  }
  const adapter = { requestDevice: vi.fn(async () => device) }
  const gpu = { requestAdapter: vi.fn(async () => (adapterNull ? null : adapter)) }
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu })
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, MAP_READ: 1 })
  vi.stubGlobal('GPUMapMode', { READ: 1 })
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(data, width, height) {
        Object.assign(this, { data, width, height })
      }
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,HEATMAP')
  return { gpu, adapter, device, buffer, mapGate }
}

const AIRPORTS = [{ lon: 10, lat: 20 }, { lon: -75, lat: 40 }]

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete navigator.gpu
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useGPUHeatmap status', () => {
  it('is unsupported synchronously when navigator.gpu is absent', () => {
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    expect(result.current.status).toBe('unsupported')
    expect(result.current.supported).toBe(false)
  })

  it('is waiting while WebGPU is present and airports are empty', () => {
    const mock = installGPU()
    const { result } = renderHook(() => useGPUHeatmap([]))
    expect(result.current.status).toBe('waiting')
    expect(result.current.supported).toBe(true)
    expect(mock.gpu.requestAdapter).not.toHaveBeenCalled()
  })

  it('is computing until the compute finishes, then ready with a canvas and computeMs', async () => {
    const mock = installGPU({ holdMap: true })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    expect(result.current.status).toBe('computing')
    expect(result.current.supported).toBe(true)
    await act(async () => mock.mapGate.resolve())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.canvas).toBe('data:image/png;base64,HEATMAP')
    expect(typeof result.current.computeMs).toBe('number')
    expect(result.current.error).toBeNull()
    expect(mock.device.pushErrorScope).toHaveBeenCalledWith('out-of-memory')
    expect(mock.device.pushErrorScope).toHaveBeenCalledWith('validation')
    expect(mock.device.popErrorScope).toHaveBeenCalledTimes(2)
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
  })

  it('is unsupported when requestAdapter resolves null', async () => {
    installGPU({ adapterNull: true })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
    expect(result.current.supported).toBe(false)
    expect(result.current.canvas).toBeNull()
  })

  it('is error when an out-of-memory scope reports an error', async () => {
    const mock = installGPU({ popErrors: [null, { message: 'Out of memory' }] })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error.message).toContain('Out of memory')
    expect(result.current.canvas).toBeNull()
    expect(result.current.supported).toBe(true)
    expect(mock.device.destroy).toHaveBeenCalled()
  })

  it('is error when the work throws', async () => {
    const mock = installGPU({ failCreate: new Error('shader boom') })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error.message).toBe('shader boom')
    expect(mock.buffer.destroy).toHaveBeenCalled()
    expect(mock.device.destroy).toHaveBeenCalled()
  })

  it('is error when the device is lost during the run', async () => {
    const lost = deferred()
    const mock = installGPU({ lost, holdMap: true })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    await waitFor(() => expect(mock.buffer.mapAsync).toHaveBeenCalled())
    await act(async () => lost.resolve({ reason: 'unknown', message: 'GPU hung' }))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.canvas).toBeNull()
  })

  it('runs the compute only once per attempt', async () => {
    const mock = installGPU()
    const { result, rerender } = renderHook(({ a }) => useGPUHeatmap(a), { initialProps: { a: AIRPORTS } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    rerender({ a: [...AIRPORTS, { lon: 1, lat: 1 }] })
    expect(result.current.status).toBe('ready')
    expect(mock.gpu.requestAdapter).toHaveBeenCalledTimes(1)
  })

  it('re-runs after an error on retry and keeps retry stable', async () => {
    const mock = installGPU({ popErrors: [{ message: 'Invalid pipeline' }] })
    const { result } = renderHook(() => useGPUHeatmap(AIRPORTS))
    const first = result.current.retry
    await waitFor(() => expect(result.current.status).toBe('error'))

    act(() => result.current.retry())
    expect(result.current.status).toBe('computing')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(mock.gpu.requestAdapter).toHaveBeenCalledTimes(2)
    expect(result.current.canvas).toBe('data:image/png;base64,HEATMAP')
    expect(result.current.retry).toBe(first)
  })
})
