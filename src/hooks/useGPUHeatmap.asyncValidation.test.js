import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGPUHeatmap } from './useGPUHeatmap.js'

// Issue #10 defect (second issue comment): WebGPU reports shader and pipeline
// validation errors asynchronously, through error scopes. The heatmap compute
// ignored them and reported success with a garbage image. A validation error
// popped from an error scope must leave the heatmap failed, not loaded.

const VALIDATION_ERROR = { message: 'Invalid ShaderModule "accumulate"' }

function installGPU() {
  const buffer = {
    mapAsync: vi.fn(async () => {}),
    getMappedRange: vi.fn(() => new ArrayBuffer(16)),
    unmap: vi.fn(),
    destroy: vi.fn(),
  }
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() }
  const device = {
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    createBuffer: vi.fn(() => buffer),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: () => pass,
      copyBufferToBuffer: vi.fn(),
      finish: () => ({}),
    })),
    pushErrorScope: vi.fn(),
    // The validation scope is popped first and holds the error.
    popErrorScope: vi.fn().mockResolvedValueOnce(VALIDATION_ERROR).mockResolvedValue(null),
    lost: new Promise(() => {}),
    destroy: vi.fn(),
  }
  const adapter = { requestDevice: vi.fn(async () => device) }
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: vi.fn(async () => adapter) },
  })
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
  return { device, buffer }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete navigator.gpu
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useGPUHeatmap asynchronous validation error', () => {
  it('reports the heatmap as failed, not ready, when an error scope pops a validation error', async () => {
    installGPU()
    const airports = [{ lon: 10, lat: 20 }]
    const { result } = renderHook(() => useGPUHeatmap(airports))

    // Wait for the compute to settle one way or the other.
    await waitFor(() => expect(result.current.canvas !== null || result.current.error != null).toBe(true))

    expect(result.current.canvas).toBeNull()
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBeTruthy()
  })
})
