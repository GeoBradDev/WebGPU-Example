import { useState, useEffect } from 'react'

async function detectGPU() {
  if (!navigator.gpu) return { tier: 'no-webgpu', adapterInfo: {} }
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return { tier: 'no-webgpu', adapterInfo: {} }
    // adapter.info is the current spec; older Chrome used requestAdapterInfo()
    const info = adapter.info ?? (await adapter.requestAdapterInfo?.()) ?? {}
    return { tier: 'webgpu', adapterInfo: info }
  } catch {
    return { tier: 'no-webgpu', adapterInfo: {} }
  }
}

export function useGPUCapabilities() {
  const [capabilities, setCapabilities] = useState({
    tier: 'unknown',
    adapterInfo: {},
  })

  useEffect(() => {
    detectGPU().then(setCapabilities)
  }, [])

  return capabilities
}