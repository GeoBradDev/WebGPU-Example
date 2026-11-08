import { Fragment, useId, useRef, useState } from 'react'
import { LAYERS } from '../config/sources.js'
import { useMapStore } from '../store/mapStore.js'
import { useMediaQuery, NARROW_QUERY } from '../hooks/useMediaQuery.js'

const LAYER_COLORS = {
  airports: 'var(--amber)',
  ports:    'var(--green)',
  heatmap:  '#ff44ff',
}

function formatCount(n) {
  if (n === 0) return '0 PTS'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M PTS`
  return `${(n / 1_000).toFixed(0)}K PTS`
}

function formatValueText(n) {
  return `${n.toLocaleString('en-US')} points`
}

// Issue #10: status line text per layer state.
const HEATMAP_TEXT = {
  waiting: 'AWAITING AIRPORTS',
  blocked: 'NO AIRPORT DATA',
  computing: 'COMPUTING...',
  ready: 'READY',
  error: 'COMPUTE FAILED',
}

function statusText(id, { status, count }) {
  if (id === 'heatmap') return HEATMAP_TEXT[status] ?? ''
  if (status === 'loading') return 'LOADING...'
  if (status === 'loaded') return `${(count ?? 0).toLocaleString('en-US')} FEATURES`
  if (status === 'error') return 'LOAD FAILED'
  return ''
}

const WEBGPU_NOTE = 'WEBGPU UNAVAILABLE: HEATMAP AND COMPUTE BENCHMARK OFF'

function LayerStatus({ id, label, entry, onRetry }) {
  const failed = entry.status === 'error'
  return (
    <div className={`layer-status${failed ? ' layer-status-error' : ''}`}>
      <span className="layer-status-text" aria-live="polite" title={failed ? entry.error?.message : undefined}>
        <span className="visually-hidden">{label}: </span>
        {statusText(id, entry)}
      </span>
      {failed && entry.onRetry ? (
        <button type="button" className="layer-retry" aria-label={`Retry ${label}`} onClick={onRetry}>
          RETRY
        </button>
      ) : null}
    </div>
  )
}

export function LayerPanel({ visibility, onToggle, heatmapSupported, status }) {
  const { stressCount, setStressCount } = useMapStore()
  const narrow = useMediaQuery(NARROW_QUERY)
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const expanded = !narrow || open
  const checkboxRefs = useRef({})

  const failedCount = status
    ? ['airports', 'ports', 'heatmap'].filter((id) => status[id]?.status === 'error').length
    : 0
  const showNote = status?.heatmap?.status === 'unsupported'

  // Focus moves to the layer checkbox before the RETRY button unmounts, so
  // keyboard focus never drops to body.
  function retry(id) {
    checkboxRefs.current[id]?.focus()
    status?.[id]?.onRetry?.()
  }

  const layerList = Object.values(LAYERS).filter(
    ({ id }) => id !== 'heatmap' || heatmapSupported
  )
  const activeCount = layerList.filter(({ id }) => visibility[id] ?? true).length
  const totalCount = layerList.length

  return (
    <aside className={`layer-panel${expanded ? '' : ' collapsed'}`}>
      {narrow ? (
        <button
          type="button"
          className="panel-header panel-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={failedCount > 0 ? `Sensor layers, ${failedCount} failed` : 'Sensor layers'}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="panel-title">SENSOR LAYERS</span>
          {failedCount > 0 ? (
            <span className="panel-alert" aria-hidden="true">{failedCount} FAILED</span>
          ) : null}
          <span className="panel-chevron" aria-hidden="true">
            {open ? '\u25B2' : '\u25BC'}
          </span>
          <span className="panel-indicator" />
        </button>
      ) : (
        <div className="panel-header">
          <span className="panel-title">SENSOR LAYERS</span>
          <span className="panel-indicator" />
        </div>
      )}

      <div id={bodyId} className="panel-body" hidden={!expanded}>
        {layerList.map(({ id, label }) => {
          const active = visibility[id] ?? true
          const entry = status?.[id]
          return (
            <Fragment key={id}>
              <label className={`layer-row${active ? ' active' : ''}`}>
                <input
                  ref={(el) => {
                    checkboxRefs.current[id] = el
                  }}
                  type="checkbox"
                  className="visually-hidden"
                  aria-label={`${label} layer`}
                  checked={active}
                  onChange={(e) => onToggle(id, e.target.checked)}
                />
                <span
                  className="layer-dot"
                  aria-hidden="true"
                  style={{ background: active ? LAYER_COLORS[id] : 'var(--text-dim)' }}
                />
                <span className="layer-label">{label.toUpperCase()}</span>
                <span className={`layer-toggle ${active ? 'on' : 'off'}`} aria-hidden="true">
                  {active ? 'ON' : 'OFF'}
                </span>
              </label>
              {entry ? <LayerStatus id={id} label={label} entry={entry} onRetry={() => retry(id)} /> : null}
            </Fragment>
          )
        })}

        {showNote ? <p className="layer-note">{WEBGPU_NOTE}</p> : null}

        <div className="panel-divider" />

        <div className="stress-section">
          <span className="panel-title">STRESS TEST</span>
          <div className="stress-row">
            <input
              type="range"
              min={0}
              max={5000000}
              step={100000}
              value={stressCount}
              onChange={(e) => setStressCount(Number(e.target.value))}
              className="stress-slider"
              aria-label="Stress test point count"
              aria-valuetext={formatValueText(stressCount)}
            />
            <span className="stress-count">{formatCount(stressCount)}</span>
          </div>
        </div>

        <div className="panel-footer">
          <span className="footer-stat">
            ACTIVE&nbsp;{activeCount}/{totalCount}
          </span>
        </div>
      </div>
    </aside>
  )
}
