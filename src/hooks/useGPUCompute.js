import { useState, useEffect } from 'react'

const COUNT = 65535 * 256  // 16,776,960 floats ~64MB, exactly 65535 workgroups
const WORKGROUP_SIZE = 256
const WORKGROUPS = COUNT / WORKGROUP_SIZE  // 65535

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

export function useGPUCompute() {
  const [state, setState] = useState({ throughput: '--', supported: false })

  useEffect(() => {
    if (!navigator.gpu) return

    let intervalId = null
    let device = null
    let buf = null

    async function init() {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) return

        device = await adapter.requestDevice()

        buf = device.createBuffer({
          size: COUNT * 4,
          usage: GPUBufferUsage.STORAGE,
          mappedAtCreation: true,
        })
        new Float32Array(buf.getMappedRange()).fill(1.0)
        buf.unmap()

        const module = device.createShaderModule({ code: SHADER })
        const pipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint: 'main' },
        })
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: buf } }],
        })

        setState({ throughput: '...', supported: true })

        intervalId = setInterval(async () => {
          try {
            const t0 = performance.now()
            const encoder = device.createCommandEncoder()
            const pass = encoder.beginComputePass()
            pass.setPipeline(pipeline)
            pass.setBindGroup(0, bindGroup)
            pass.dispatchWorkgroups(WORKGROUPS)
            pass.end()
            device.queue.submit([encoder.finish()])
            await device.queue.onSubmittedWorkDone()
            const elapsed = (performance.now() - t0) / 1000
            // 128MB traffic per dispatch: 64MB read + 64MB write
            const gbps = (0.128 / elapsed).toFixed(1)
            setState({ throughput: `${gbps} GB/s`, supported: true })
          } catch {
            setState({ throughput: '--', supported: false })
          }
        }, 1000)
      } catch {
        setState({ throughput: '--', supported: false })
      }
    }

    init()

    return () => {
      if (intervalId) clearInterval(intervalId)
      buf?.destroy()
      device?.destroy()
    }
  }, [])

  return state
}