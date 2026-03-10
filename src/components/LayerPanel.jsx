import { LAYERS } from '../config/sources.js'

const LAYER_COLORS = {
  points: 'var(--amber)',
  adsb: 'var(--blue)',
}

export function LayerPanel({ visibility, onToggle }) {
  const layerList = Object.values(LAYERS)
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