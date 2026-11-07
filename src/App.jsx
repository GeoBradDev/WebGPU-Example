import { useState, useEffect } from 'react'
import { useMapStore } from './store/mapStore.js'
import { MapView } from './components/MapView.jsx'
import { LayerPanel } from './components/LayerPanel.jsx'
import { FeaturePopup } from './components/FeaturePopup.jsx'
import { useAirports } from './hooks/useAirports.js'
import { usePorts } from './hooks/usePorts.js'
import { useStressPoints } from './hooks/useStressPoints.js'
import { useGPUHeatmap } from './hooks/useGPUHeatmap.js'

function Header() {
  const viewport = useMapStore((s) => s.viewport)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const utc = time.toISOString().replace('T', ' ').slice(0, 19) + 'Z'
  const lat = Math.abs(viewport.latitude).toFixed(4) + (viewport.latitude >= 0 ? '°N' : '°S')
  const lon = Math.abs(viewport.longitude).toFixed(4) + (viewport.longitude >= 0 ? '°E' : '°W')

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="classification-badge">UNCLASSIFIED</span>
        <span className="header-sep">◆</span>
        <span className="header-status">
          SYS&nbsp;<span className="ok">NOMINAL</span>
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

  const { airports } = useAirports()
  const { ports } = usePorts()
  const { stressPoints } = useStressPoints(stressCount)
  const { canvas: heatmapCanvas, computeMs, supported: heatmapSupported } = useGPUHeatmap(airports)

  const layerData = {
    airports,
    ports,
    stressPoints,
    heatmapCanvas,
  }

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <MapView layerData={layerData} heatmapComputeMs={computeMs} />
        <LayerPanel visibility={layerVisibility} onToggle={setLayerVisibility} heatmapSupported={heatmapSupported} />
        <FeaturePopup feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      </div>
    </div>
  )
}
