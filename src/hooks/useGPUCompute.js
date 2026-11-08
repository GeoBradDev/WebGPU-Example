import { useState, useEffect, useRef, useCallback } from 'react'

const COUNT = 65535 * 256  // 16,776,960 floats ~64MB, exactly 65535 workgroups
const WORKGROUP_SIZE = 256
const WORKGROUPS = COUNT / WORKGROUP_SIZE  // 65535
// 128MB traffic per dispatch: 64MB read + 64MB write
const BYTES_PER_DISPATCH_GB = 0.128
const LOST = Symbol('lost')

export const BENCHMARK_DISPATCHES = 5

const SHADER = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < arrayLength(&data)) {
    data[i] = data[i] * 1.0000001;
  }
}
`

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// CPU-timed, so it includes submit and callback latency: an estimate.
// A coarse timer can report 0, so anything but a positive finite time is
// shown as Too fast rather than Infinity.
export function formatThroughput(seconds) {
  if (!(Number.isFinite(seconds) && seconds > 0)) return 'Too fast'
  return `~${(BYTES_PER_DISPATCH_GB / seconds).toFixed(1)} GB/s est.`
}

function isHidden() {
  return document.visibilityState === 'hidden'
}

export function useGPUCompute() {
  const [state, setState] = useState(() => ({
    throughput: '--',
    supported: Boolean(navigator.gpu),
    running: false,
  }))

  const activeRef = useRef(false)
  const stopRef = useRef(false)
  const mountedRef = useRef(false)
  const resourcesRef = useRef({ buffer: null, device: null })

  const release = useCallback(() => {
    const res = resourcesRef.current
    res.buffer?.destroy()
    res.device?.destroy()
    res.buffer = null
    res.device = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopRef.current = true
      release()
    }
  }, [release])

  const run = useCallback(async () => {
    if (activeRef.current || !mountedRef.current || !navigator.gpu || isHidden()) return
    activeRef.current = true
    stopRef.current = false
    const stopped = () => stopRef.current || !mountedRef.current

    const update = (next) => {
      if (mountedRef.current) setState((s) => ({ ...s, ...next }))
    }
    const onVisibility = () => {
      if (isHidden()) stopRef.current = true
    }
    document.addEventListener('visibilitychange', onVisibility)
    update({ running: true, throughput: 'Running...' })

    const res = resourcesRef.current
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (stopped()) {
        update({ throughput: 'Stopped' })
        return
      }
      if (!adapter) {
        update({ supported: false, throughput: '--' })
        return
      }

      // Assigned before the stop check so a device that arrives after a stop
      // is still destroyed in finally.
      res.device = await adapter.requestDevice()
      if (stopped()) {
        update({ throughput: 'Stopped' })
        return
      }
      const device = res.device

      // Out-of-memory and validation errors are reported asynchronously, and an
      // invalid buffer or pipeline turns submits into no-ops, so collect them.
      device.pushErrorScope('out-of-memory')
      device.pushErrorScope('validation')
      let lostReason = null
      const lost = device.lost.then((info) => {
        lostReason = info?.reason ?? 'unknown'
        return LOST
      })

      res.buffer = device.createBuffer({
        size: COUNT * 4,
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      })
      new Float32Array(res.buffer.getMappedRange()).fill(1.0)
      res.buffer.unmap()

      const module = device.createShaderModule({ code: SHADER })
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      })
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: res.buffer } }],
      })

      const timings = []
      let failed = false
      for (let k = 0; k < BENCHMARK_DISPATCHES; k++) {
        if (stopped()) break
        const t0 = performance.now()
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginComputePass()
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.dispatchWorkgroups(WORKGROUPS)
        pass.end()
        device.queue.submit([encoder.finish()])
        const outcome = await Promise.race([device.queue.onSubmittedWorkDone(), lost])
        if (outcome === LOST) {
          // 'destroyed' is our own release on unmount, so it counts as a stop.
          failed = lostReason !== 'destroyed'
          break
        }
        timings.push((performance.now() - t0) / 1000)
      }

      if (lostReason === null) {
        const validationError = await device.popErrorScope()
        const oomError = await device.popErrorScope()
        if (validationError || oomError) failed = true
      }

      if (failed) {
        update({ throughput: 'Failed' })
      } else if (stopRef.current || timings.length < BENCHMARK_DISPATCHES) {
        update({ throughput: 'Stopped' })
      } else {
        update({ throughput: formatThroughput(median(timings)) })
      }
    } catch {
      update({ throughput: 'Failed' })
    } finally {
      document.removeEventListener('visibilitychange', onVisibility)
      release()
      activeRef.current = false
      update({ running: false })
    }
  }, [release])

  return { ...state, run }
}
