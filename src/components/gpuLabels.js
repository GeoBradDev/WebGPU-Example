// Pure label helpers for the GPU info panel (issue #8).

// A Map, not a plain object, so names like '__proto__' or 'toString' miss.
const BACKEND_LABELS = new Map([
  ['webgl', 'WebGL2'], // luma.gl's WebGL2 device reports type 'webgl'
  ['webgl2', 'WebGL2'],
  ['webgpu', 'WebGPU'],
])

// RENDER names the luma.gl device type deck.gl actually created. It never
// looks at the WebGPU adapter tier. A device that could not be created or was
// lost (issue #10) shows an error state instead.
export function renderBackendLabel(deviceType, status) {
  if (status === 'failed') return { text: 'Failed', ok: false, err: true }
  if (status === 'lost') return { text: 'Lost', ok: false, err: true }
  if (!deviceType) return { text: 'Detecting...', ok: false }
  const text = BACKEND_LABELS.get(deviceType)
  return text ? { text, ok: true } : { text: 'Unknown', ok: false }
}

// GPU names the adapter when WebGPU describes it, otherwise the renderer
// string of deck's render device (the unmasked WebGL renderer when exposed).
export function gpuDeviceLabel(adapterInfo, renderDevice) {
  const info = adapterInfo ?? {}
  const vendorArch = [info.vendor, info.architecture].filter(Boolean).join(' ')
  return info.device || info.description || vendorArch || renderDevice?.renderer || 'Unknown'
}
