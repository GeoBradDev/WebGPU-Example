import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../config/maplibreWorker.js'
import { buildLayers } from '../layers/index.js'
import { useMapStore } from '../store/mapStore.js'
import { BASEMAP_STYLE } from '../config/sources.js'
import { useGPUCapabilities } from '../hooks/useGPUCapabilities.js'
import { useGPUCompute } from '../hooks/useGPUCompute.js'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

function DeckGLOverlay({ layers, onDeviceInitialized }) {
  // MapboxOverlay builds its Deck in onAdd from the constructor props, so the
  // device callback must be passed here, not later through setProps.
  const overlay = useControl(
    () => new MapboxOverlay({ interleaved: false, useDevicePixels: false, onDeviceInitialized })
  )
  overlay.setProps({ layers })
  return null
}

function useFrameTime() {
  const [frameTime, setFrameTime] = useState(0)
  const [frameHistory, setFrameHistory] = useState([])
  // eslint-disable-next-line react-hooks/purity
  const lastRef = useRef(performance.now())

  useEffect(() => {
    let rafId
    function tick(now) {
      const dt = Math.round(now - lastRef.current)
      lastRef.current = now
      setFrameTime(dt)
      setFrameHistory((h) => {
        const next = [...h, dt]
        return next.length > 60 ? next.slice(next.length - 60) : next
      })
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return { frameTime, frameHistory }
}

export function MapView({ layerData, heatmapComputeMs }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()
  const gpuBase = useGPUCapabilities()
  const [renderDevice, setRenderDevice] = useState(null)
  const onDeviceInitialized = useCallback(
    (device) => setRenderDevice({ type: device.type, renderer: device.info?.renderer }),
    []
  )
  const { frameTime, frameHistory } = useFrameTime()
  const { throughput: gpuThroughput, supported: benchSupported, running: benchRunning, run: runBenchmark } =
    useGPUCompute()

  const activePointCount =
    (layerVisibility.airports ? (layerData.airports?.length ?? 0) : 0) +
    (layerVisibility.ports    ? (layerData.ports?.length ?? 0)    : 0) +
    (layerData.stressPoints?.length ?? 0)

  const capabilities = useMemo(
    () => ({ ...gpuBase, renderDevice, activePointCount, frameTime, frameHistory, gpuThroughput, heatmapComputeMs }),
    [gpuBase, renderDevice, activePointCount, frameTime, frameHistory, gpuThroughput, heatmapComputeMs]
  )

  const benchmark = useMemo(
    () => ({ supported: benchSupported, running: benchRunning, onRun: runBenchmark }),
    [benchSupported, benchRunning, runBenchmark]
  )

  const onFeatureClick = useCallback(
    (feature) => setSelectedFeature(feature),
    [setSelectedFeature]
  )

  const layers = useMemo(
    () => buildLayers(layerVisibility, layerData, onFeatureClick),
    [layerVisibility, layerData, onFeatureClick]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        {...viewport}
        style={{ width: '100%', height: '100%' }}
        mapStyle={BASEMAP_STYLE}
        onMove={(evt) => setViewport(evt.viewState)}
      >
        <DeckGLOverlay layers={layers} onDeviceInitialized={onDeviceInitialized} />
      </Map>
      <div className="map-vignette" />
      <GPUInfoPanel capabilities={capabilities} benchmark={benchmark} />
    </div>
  )
}