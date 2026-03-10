import { LAYERS } from '../config/sources.js'

const LAYER_COLORS = {
  points:   'var(--amber)',
  polygons: 'var(--blue)',
}

export function LayerPanel({ visibility, onToggle }) {
  const activeCount = Object.values(visibility).filter(Boolean).length
  const totalCount = Object.keys(LAYERS).length

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        <span className="panel-title">SENSOR LAYERS</span>
        <span className="panel-indicator" />
      </div>

      {Object.values(LAYERS).map(({ id, label }) => {
        const active = visibility[id] ?? true
        return (
          <label key={id} className={`layer-row${active ? ' active' : ''}`}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => onToggle(id, e.target.checked)}
            />
            <span
              className="layer-dot"
              style={{ background: active ? LAYER_COLORS[id] : 'var(--text-dim)' }}
            />
            <span className="layer-label">{label.toUpperCase()}</span>
            <span className={`layer-toggle ${active ? 'on' : 'off'}`}>
              {active ? 'ON' : 'OFF'}
            </span>
          </label>
        )
      })}

      <div className="panel-footer">
        <span className="footer-stat">
          ACTIVE&nbsp;{activeCount}/{totalCount}
        </span>
      </div>
    </aside>
  )
}