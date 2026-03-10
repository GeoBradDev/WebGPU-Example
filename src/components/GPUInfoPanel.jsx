export function GPUInfoPanel({ capabilities }) {
  const { tier, adapterInfo, activePointCount, frameTime } = capabilities

  const deviceLabel =
    adapterInfo.device || adapterInfo.description || adapterInfo.vendor || adapterInfo.architecture || 'Unknown'
  const renderLabel =
    tier === 'no-webgpu' ? 'WebGL Fallback' : tier === 'unknown' ? 'Detecting...' : 'WebGPU'
  const isWebGPU = tier === 'webgpu'

  return (
    <div className="gpu-info-panel">
      <span className="gpu-info-item">
        <span className="gpu-info-key">GPU</span>
        <span className="gpu-info-val">{deviceLabel}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">RENDER</span>
        <span className={`gpu-info-val ${isWebGPU ? 'ok' : 'warn'}`}>{renderLabel}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">PTS</span>
        <span className="gpu-info-val">{activePointCount.toLocaleString()}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">FRAME</span>
        <span className="gpu-info-val">{frameTime}ms</span>
      </span>
    </div>
  )
}