import { useState, useEffect, useRef, useCallback } from 'react'
import { HEATMAP_GRID_W as GRID_W, HEATMAP_GRID_H as GRID_H, binningWGSL } from '../layers/heatmapProjection.js'

const GRID_SIZE = GRID_W * GRID_H
const WORKGROUP_SIZE = 256
const LOST = Symbol('lost')

// ---- WGSL shaders --------------------------------------------------------

export const ACCUMULATE_SHADER = `
struct Params { count: u32 }

@group(0) @binding(0) var<storage, read>       points: array<vec2<f32>>;
@group(0) @binding(1) var<uniform>             params: Params;
@group(0) @binding(2) var<storage, read_write> grid:   array<atomic<u32>>;
${binningWGSL()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }

  let lon = points[i].x;
  let lat = points[i].y;

  // Bin in Web Mercator to match the BitmapLayer bounds (see heatmapProjection.js)
  let col = lonToCol(lon);
  let row = latToRow(lat);

  atomicAdd(&grid[row * ${GRID_W}u + col], 1u);
}
`

const COLORIZE_SHADER = `
struct Params { maxCount: u32 }

@group(0) @binding(0) var<storage, read>       grid:   array<u32>;
@group(0) @binding(1) var<uniform>             params: Params;
@group(0) @binding(2) var<storage, read_write> rgba:   array<u32>;

fn colorRamp(t: f32) -> vec4<f32> {
  // 4-stop ramp: transparent -> deep blue -> orange -> white
  if (t <= 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  if (t < 0.1) {
    let s = t / 0.1;
    return mix(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(0.0, 0.0, 0.706, 0.706), s);
  }
  if (t < 0.5) {
    let s = (t - 0.1) / 0.4;
    return mix(vec4<f32>(0.0, 0.0, 0.706, 0.706), vec4<f32>(1.0, 0.549, 0.0, 0.784), s);
  }
  let s = (t - 0.5) / 0.5;
  return mix(vec4<f32>(1.0, 0.549, 0.0, 0.784), vec4<f32>(1.0, 1.0, 1.0, 0.902), s);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= ${GRID_SIZE}u) { return; }

  let count = grid[idx];
  let t = select(0.0, f32(count) / f32(params.maxCount), params.maxCount > 0u);
  let c = colorRamp(t);

  let r = u32(clamp(c.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(c.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(c.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(c.a * 255.0, 0.0, 255.0));

  // Pack as RGBA little-endian: R at byte 0, matches ImageData Uint8ClampedArray layout
  rgba[idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
`

// ---- Pure helper (exported for testing) ----------------------------------

/**
 * Pack airport lon/lat pairs into a Float32Array for GPU upload.
 * @param {Array<{lon: number, lat: number}>} airports
 * @returns {Float32Array}
 */
export function buildPointsData(airports) {
  const data = new Float32Array(airports.length * 2)
  for (let i = 0; i < airports.length; i++) {
    data[i * 2]     = airports[i].lon
    data[i * 2 + 1] = airports[i].lat
  }
  return data
}

// ---- Hook ----------------------------------------------------------------

const NO_RESULT = { attempt: -1, status: null, canvas: null, computeMs: null, error: null }

/**
 * Runs a two-pass WebGPU compute shader to generate an airport density heatmap.
 * Runs once per attempt when airports.length > 0; retry starts a new attempt.
 *
 * status (issue #10):
 *   'unsupported' - navigator.gpu is absent, or requestAdapter() resolved null
 *   'waiting'     - WebGPU is present and airports are empty
 *   'computing'   - the compute for the current attempt has not finished
 *   'ready'       - finished with no error; canvas and computeMs are set
 *   'error'       - a thrown error, an error-scope error, or a device loss
 *
 * @param {Array<{lon: number, lat: number}>} airports
 * @returns {{ canvas: string|null, computeMs: number|null, supported: boolean, error: Error|null,
 *   status: string, retry: () => void }}
 */
export function useGPUHeatmap(airports) {
  // navigator.gpu is known synchronously at first render.
  const [gpuPresent] = useState(() => Boolean(navigator.gpu))
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(NO_RESULT)
  const startedRef = useRef(-1)
  const runningRef = useRef(false)

  useEffect(() => {
    if (startedRef.current === attempt || airports.length === 0) return
    if (!navigator.gpu) return

    startedRef.current = attempt
    runningRef.current = true
    const thisAttempt = attempt

    let device = null
    const buffers = []

    function track(buf) { buffers.push(buf); return buf }

    async function run() {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) {
          setResult({ ...NO_RESULT, attempt: thisAttempt, status: 'unsupported' })
          return
        }
        device = await adapter.requestDevice()

        // Shader, pipeline, and allocation errors are reported asynchronously,
        // so collect them in error scopes and treat a device loss as a failure.
        device.pushErrorScope('out-of-memory')
        device.pushErrorScope('validation')
        let lostInfo = null
        const lost = device.lost.then((info) => {
          lostInfo = info ?? {}
          return LOST
        })
        const lostError = () => new Error(`WebGPU device lost${lostInfo?.message ? `: ${lostInfo.message}` : ''}`)
        const untilLost = async (promise) => {
          const outcome = await Promise.race([promise, lost])
          if (outcome === LOST) throw lostError()
          return outcome
        }

        const airportCount = airports.length
        const pointsData = buildPointsData(airports)

        // ---- Allocate buffers ----
        const pointsBuf = track(device.createBuffer({
          size: pointsData.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }))
        device.queue.writeBuffer(pointsBuf, 0, pointsData)

        const uniformBuf1 = track(device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }))
        device.queue.writeBuffer(uniformBuf1, 0, new Uint32Array([airportCount]))

        const gridBytes = GRID_SIZE * 4
        const gridBuf = track(device.createBuffer({
          size: gridBytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        }))
        const gridStagingBuf = track(device.createBuffer({
          size: gridBytes,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }))

        const uniformBuf2 = track(device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }))

        const rgbaBytes = GRID_SIZE * 4
        const rgbaBuf = track(device.createBuffer({
          size: rgbaBytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        }))
        const rgbaStagingBuf = track(device.createBuffer({
          size: rgbaBytes,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }))

        // ---- Pass 1: Accumulate ----
        const accModule = device.createShaderModule({ code: ACCUMULATE_SHADER })
        const accPipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module: accModule, entryPoint: 'main' },
        })
        const accBindGroup = device.createBindGroup({
          layout: accPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: pointsBuf } },
            { binding: 1, resource: { buffer: uniformBuf1 } },
            { binding: 2, resource: { buffer: gridBuf } },
          ],
        })

        const t0 = performance.now()

        let enc = device.createCommandEncoder()
        let pass = enc.beginComputePass()
        pass.setPipeline(accPipeline)
        pass.setBindGroup(0, accBindGroup)
        pass.dispatchWorkgroups(Math.ceil(airportCount / WORKGROUP_SIZE))
        pass.end()
        enc.copyBufferToBuffer(gridBuf, 0, gridStagingBuf, 0, gridBytes)
        device.queue.submit([enc.finish()])

        await untilLost(gridStagingBuf.mapAsync(GPUMapMode.READ))
        const gridData = new Uint32Array(gridStagingBuf.getMappedRange().slice(0))
        gridStagingBuf.unmap()
        const maxCount = gridData.reduce((a, b) => Math.max(a, b), 0)
        // ---- Pass 2: Colorize ----
        device.queue.writeBuffer(uniformBuf2, 0, new Uint32Array([maxCount]))

        const colModule = device.createShaderModule({ code: COLORIZE_SHADER })
        const colPipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module: colModule, entryPoint: 'main' },
        })
        const colBindGroup = device.createBindGroup({
          layout: colPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: gridBuf } },
            { binding: 1, resource: { buffer: uniformBuf2 } },
            { binding: 2, resource: { buffer: rgbaBuf } },
          ],
        })

        enc = device.createCommandEncoder()
        pass = enc.beginComputePass()
        pass.setPipeline(colPipeline)
        pass.setBindGroup(0, colBindGroup)
        pass.dispatchWorkgroups(Math.ceil(GRID_SIZE / WORKGROUP_SIZE))
        pass.end()
        enc.copyBufferToBuffer(rgbaBuf, 0, rgbaStagingBuf, 0, rgbaBytes)
        device.queue.submit([enc.finish()])

        await untilLost(rgbaStagingBuf.mapAsync(GPUMapMode.READ))
        const rgbaData = new Uint8ClampedArray(rgbaStagingBuf.getMappedRange().slice(0))
        rgbaStagingBuf.unmap()

        const computeMs = Math.round(performance.now() - t0)

        // Popped in reverse order of the pushes, after the last readback.
        const validationError = await untilLost(device.popErrorScope())
        const oomError = await untilLost(device.popErrorScope())
        const scopeError = validationError || oomError
        if (scopeError) throw new Error(scopeError.message || 'WebGPU validation error')
        if (lostInfo) throw lostError()

        // ---- Draw to canvas and convert to data URL for deck.gl BitmapLayer compatibility ----
        const canvas = document.createElement('canvas')
        canvas.width = GRID_W
        canvas.height = GRID_H
        canvas.getContext('2d').putImageData(new ImageData(rgbaData, GRID_W, GRID_H), 0, 0)
        const imageUrl = canvas.toDataURL()

        setResult({ attempt: thisAttempt, status: 'ready', canvas: imageUrl, computeMs, error: null })
      } catch (err) {
        console.error('[useGPUHeatmap]', err)
        setResult({ ...NO_RESULT, attempt: thisAttempt, status: 'error', error: err })
      } finally {
        for (const buf of buffers) buf.destroy()
        device?.destroy()
        runningRef.current = false
      }
    }

    run()
  }, [airports.length, attempt])  // eslint-disable-line react-hooks/exhaustive-deps

  // Called from an event handler; a run in progress is never doubled.
  const retry = useCallback(() => {
    if (runningRef.current) return
    setAttempt((a) => a + 1)
  }, [])

  let status
  if (!gpuPresent || result.status === 'unsupported') status = 'unsupported'
  else if (airports.length === 0) status = 'waiting'
  else if (result.attempt === attempt) status = result.status
  else status = 'computing'

  const ready = status === 'ready'
  return {
    canvas: ready ? result.canvas : null,
    computeMs: ready ? result.computeMs : null,
    supported: status !== 'unsupported',
    error: status === 'error' ? result.error : null,
    status,
    retry,
  }
}