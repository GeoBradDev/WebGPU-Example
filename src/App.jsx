import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useAirports } from './hooks/useAirports.js'
import { usePorts } from './hooks/usePorts.js'
import { useStressPoints } from './hooks/useStressPoints.js'
import { useGPUHeatmap } from './hooks/useGPUHeatmap.js'
import { deriveSystemStatus } from './status/systemStatus.js'

const LEVEL_CLASS = { NOMINAL: 'ok', LOADING: 'warn', DEGRADED: 'err' }

function loadStatus({ loaded, error }) {
  if (error) return 'error'
  return loaded ? 'loaded' : 'loading'
}

function Header({ status }) {
  const viewport = useMapStore((s) => s.viewport)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const issues = status.issues.join(', ')
  const utc = time.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
  const lat = Math.abs(viewport.latitude).toFixed(4) + (viewport.latitude >= 0 ? '°N' : '°S')
  const lon = Math.abs(viewport.longitude).toFixed(4) + (viewport.longitude >= 0 ? '°E' : '°W')

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="classification-badge">UNCLASSIFIED</span>
        <span className="header-sep">◆</span>
        <span
          className="header-status"
          role="status"
          aria-live="polite"
          title={issues || undefined}
        >
          SYS&nbsp;<span className={LEVEL_CLASS[status.level]}>{status.level}</span>
          {issues ? <span className="visually-hidden">: {issues}</span> : null}
        </span>
      </div>

      <div className="header-center">
        <span className="app-title">WebGPU Groundtruth</span>
      </div>

      <div className="header-right">
        <span className="coord-display">{lat}&nbsp;&nbsp;{lon}</span>
        <span className="header-sep">◆</span>
        <span className="time-display">{utc}</span>
      </div>
    </header>
  )
}

export default function App() {
  const {
    layerVisibility,
    setLayerVisibility,
    selectedFeature,
    setSelectedFeature,
    stressCount,
  } = useMapStore()

  const render = useMapStore((s) => s.render)
  const basemapFailed = useMapStore((s) => s.basemapFailed)

  const airportsQuery = useAirports()
  const portsQuery = usePorts()
  // airports: every included airport (heatmap set); majorAirports: large and
  // medium only, the points drawn and counted in the layer panel (issue #9).
  const { airports, majorAirports } = airportsQuery
  const { ports } = portsQuery
  const { stressPoints } = useStressPoints(stressCount)
  const heatmap = useGPUHeatmap(airports)
  const { canvas: heatmapCanvas, computeMs, supported: heatmapSupported } = heatmap

  const airportsStatus = loadStatus(airportsQuery)
  const portsStatus = loadStatus(portsQuery)
  const systemStatus = deriveSystemStatus({
    airports: airportsStatus,
    ports: portsStatus,
    heatmap: heatmap.status,
    render: render.status,
    basemapFailed,
  })

  // The heatmap waits on airports; once they failed or loaded empty it has
  // nothing to wait for.
  const airportsSettledEmpty =
    airportsStatus === 'error' || (airportsStatus === 'loaded' && airports.length === 0)
  const heatmapPanelStatus =
    heatmap.status === 'waiting' && airportsSettledEmpty ? 'blocked' : heatmap.status
  const layerStatus = {
    airports: { status: airportsStatus, count: majorAirports.length, error: airportsQuery.error, onRetry: airportsQuery.retry },
    ports: { status: portsStatus, count: ports.length, error: portsQuery.error, onRetry: portsQuery.retry },
    heatmap: { status: heatmapPanelStatus, error: heatmap.error, onRetry: heatmap.retry },
  }

  const layerData = {
    airports: majorAirports,
    ports,
    stressPoints,
    heatmapCanvas,
  }

  return (
    <div className="app-shell">
      <Header status={systemStatus} />
      <div className="app-body">
        <MapView layerData={layerData} heatmapComputeMs={computeMs} />
        <LayerPanel
          visibility={layerVisibility}
          onToggle={setLayerVisibility}
          heatmapSupported={heatmapSupported}
          status={layerStatus}
        />
        <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      </div>
    </div>
  )
}
