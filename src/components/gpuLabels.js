// Pure label helpers for the GPU info panel (issue #8).

const BACKEND_LABELS = {
  webgl: 'WebGL2', // luma.gl's WebGL2 device reports type 'webgl'
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
}

// RENDER names the luma.gl device type deck.gl actually created. It never
// looks at the WebGPU adapter tier.
export function renderBackendLabel(deviceType) {
  if (!deviceType) return { text: 'Detecting...', ok: false }
  const text = BACKEND_LABELS[deviceType]
  return text ? { text, ok: true } : { text: 'Unknown', ok: false }
}

// GPU names the adapter when WebGPU describes it, otherwise the renderer
// string of deck's render device (the unmasked WebGL renderer when exposed).
export function gpuDeviceLabel(adapterInfo, renderDevice) {
  const info = adapterInfo ?? {}
  const vendorArch = [info.vendor, info.architecture].filter(Boolean).join(' ')
  return info.device || info.description || vendorArch || renderDevice?.renderer || 'Unknown'
}
