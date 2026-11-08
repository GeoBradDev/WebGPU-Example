import { useState, useEffect, useRef } from 'react'
import { HEATMAP_GRID_W as GRID_W, HEATMAP_GRID_H as GRID_H, binningWGSL } from '../layers/heatmapProjection.js'

const GRID_SIZE = GRID_W * GRID_H
const WORKGROUP_SIZE = 256

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

/**
 * Runs a two-pass WebGPU compute shader to generate an airport density heatmap.
 * Fires once when airports.length > 0. Returns canvas when complete.
 *
 * @param {Array<{lon: number, lat: number}>} airports
 * @returns {{ canvas: HTMLCanvasElement|null, computeMs: number|null, supported: boolean, error: Error|null }}
 */
export function useGPUHeatmap(airports) {
  const [state, setState] = useState({ canvas: null, computeMs: null, supported: false, error: null })
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current || airports.length === 0) return
    if (!navigator.gpu) return

    hasRun.current = true

    let device = null
    const buffers = []

    function track(buf) { buffers.push(buf); return buf }

    async function run() {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) throw new Error('No WebGPU adapter available')
        device = await adapter.requestDevice()

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

        await gridStagingBuf.mapAsync(GPUMapMode.READ)
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

        await rgbaStagingBuf.mapAsync(GPUMapMode.READ)
        const rgbaData = new Uint8ClampedArray(rgbaStagingBuf.getMappedRange().slice(0))
        rgbaStagingBuf.unmap()

        const computeMs = Math.round(performance.now() - t0)

        // ---- Draw to canvas and convert to data URL for deck.gl BitmapLayer compatibility ----
        const canvas = document.createElement('canvas')
        canvas.width = GRID_W
        canvas.height = GRID_H
        canvas.getContext('2d').putImageData(new ImageData(rgbaData, GRID_W, GRID_H), 0, 0)
        const imageUrl = canvas.toDataURL()

        setState({ canvas: imageUrl, computeMs, supported: true, error: null })
      } catch (err) {
        console.error('[useGPUHeatmap]', err)
        setState({ canvas: null, computeMs: null, supported: false, error: err })
      } finally {
        for (const buf of buffers) buf.destroy()
        device?.destroy()
      }
    }

    run()
  }, [airports.length])  // eslint-disable-line react-hooks/exhaustive-deps

  return state
}