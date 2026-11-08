import { renderBackendLabel, gpuDeviceLabel } from './gpuLabels.js'

function Sparkline({ history }) {
  if (!history || history.length === 0) return null

  const max = Math.max(...history)
  const min = Math.min(...history)
  const range = max - min || 1
  const BAR_W = 2
  const HEIGHT = 16

  return (
    <svg
      width={history.length * BAR_W}
      height={HEIGHT}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '6px' }}
    >
      {history.map((t, i) => {
        const h = Math.max(2, Math.round(((t - min) / range) * 12) + 2)
        return (
          <rect
            key={i}
            x={i * BAR_W}
            y={HEIGHT - h}
            width={BAR_W - 0.5}
            height={h}
            fill={i === history.length - 1 ? 'var(--blue)' : 'var(--text-dim)'}
          />
        )
      })}
    </svg>
  )
}

const NO_BENCHMARK = { supported: false, running: false, onRun: undefined }

function BenchmarkButton({ running, onRun }) {
  return (
    <button
      type="button"
      className="gpu-bench-btn"
      aria-label="Run compute benchmark"
      aria-disabled={running ? 'true' : undefined}
      onClick={running ? undefined : onRun}
    >
      RUN
    </button>
  )
}

export function GPUInfoPanel({ capabilities, benchmark = NO_BENCHMARK }) {
  const { tier, adapterInfo, renderDevice, activePointCount, frameTime, frameHistory, gpuThroughput, heatmapComputeMs } =
    capabilities

  const deviceLabel = gpuDeviceLabel(adapterInfo, renderDevice)
  // RENDER is the backend deck.gl created; the WebGPU tier only gates compute.
  const render = renderBackendLabel(renderDevice?.type)
  const isWebGPU = tier === 'webgpu'
  const frameClass = frameTime <= 16 ? 'ok' : frameTime <= 33 ? 'warn' : 'err'

  return (
    <div className="gpu-info-panel">
      <span className="gpu-info-item gpu-info-secondary">
        <span className="gpu-info-key">GPU</span>
        <span className="gpu-info-val">{deviceLabel}</span>
      </span>
      <span className="gpu-info-sep gpu-info-secondary">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">RENDER</span>
        <span className={`gpu-info-val ${render.ok ? 'ok' : 'warn'}`}>{render.text}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">PTS</span>
        <span className="gpu-info-val">{activePointCount.toLocaleString()}</span>
      </span>
      <span className="gpu-info-sep">|</span>
      <span className="gpu-info-item">
        <span className="gpu-info-key">FRAME</span>
        <span className={`gpu-info-val ${frameClass}`}>
          {frameTime}ms
          <Sparkline history={frameHistory} />
        </span>
      </span>
      <span className="gpu-info-sep gpu-info-secondary">|</span>
      <span className="gpu-info-item gpu-info-secondary">
        <span className="gpu-info-key">WEBGPU COMPUTE</span>
        <span className="gpu-info-val" aria-live="polite">{gpuThroughput}</span>
        {/* navigator.gpu can exist with no adapter, so also require the detected tier. */}
        {benchmark.supported && isWebGPU ? (
          <BenchmarkButton running={benchmark.running} onRun={benchmark.onRun} />
        ) : null}
      </span>
      <span className="gpu-info-sep gpu-info-secondary">|</span>
      <span className="gpu-info-item gpu-info-secondary">
        <span className="gpu-info-key">HEATMAP</span>
        <span className="gpu-info-val">
          {heatmapComputeMs != null ? `${heatmapComputeMs} ms` : '--'}
        </span>
      </span>
    </div>
  )
}