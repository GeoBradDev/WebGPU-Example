import { LAYERS } from '../config/sources.js'
import { useMapStore } from '../store/mapStore.js'

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

export function LayerPanel({ visibility, onToggle, heatmapSupported }) {
  const { stressCount, setStressCount } = useMapStore()

  const layerList = Object.values(LAYERS).filter(
    ({ id }) => id !== 'heatmap' || heatmapSupported
  )
  const activeCount = layerList.filter(({ id }) => visibility[id] ?? true).length
  const totalCount = layerList.length

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        <span className="panel-title">SENSOR LAYERS</span>
        <span className="panel-indicator" />
      </div>

      {layerList.map(({ id, label }) => {
        const active = visibility[id] ?? true
        return (
          <label key={id} className={`layer-row${active ? ' active' : ''}`}>
            <input
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
        )
      })}

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
    </aside>
  )
}
