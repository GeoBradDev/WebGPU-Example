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

function DeckGLOverlay({ layers, onDeviceInitialized, onError }) {
  // MapboxOverlay builds its Deck in onAdd from the constructor props, so the
  // device and error callbacks must be passed here, not later through setProps.
  const overlay = useControl(
    () => new MapboxOverlay({ interleaved: false, useDevicePixels: false, onDeviceInitialized, onError })
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

// Render device health (issue #10). deck.gl reports the device it created, or
// an error through onError. Only an error before the device exists means
// device creation failed; later ones are layer or picking errors. The lost
// promise resolves on WebGL context loss and on our own unmount, so the
// mounted guard, not the reason, tells them apart.
function useRenderHealth() {
  const render = useMapStore((s) => s.render)
  const setRender = useMapStore((s) => s.setRender)
  const deviceRef = useRef(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      deviceRef.current = null
    }
  }, [])

  const onDeviceInitialized = useCallback(
    (device) => {
      deviceRef.current = device
      const next = { status: 'ready', type: device.type, renderer: device.info?.renderer ?? null }
      setRender(next)
      device.lost?.then(() => {
        if (mountedRef.current && deviceRef.current === device) setRender({ ...next, status: 'lost' })
      })
    },
    [setRender]
  )

  const onError = useCallback(
    (error) => {
      console.error(error)
      if (!deviceRef.current) setRender({ status: 'failed', type: null, renderer: null })
    },
    [setRender]
  )

  return { render, onDeviceInitialized, onError }
}

// Basemap health (issue #10). A MapLibre error with no sourceId before load is
// a style, sprite, or other style-load failure; tile and source errors carry a
// sourceId, and anything after load leaves the drawn basemap in place.
function useBasemapHealth() {
  const basemapFailed = useMapStore((s) => s.basemapFailed)
  const setBasemapFailed = useMapStore((s) => s.setBasemapFailed)
  const loadedRef = useRef(false)

  const onLoad = useCallback(() => {
    loadedRef.current = true
    setBasemapFailed(false)
  }, [setBasemapFailed])

  const onError = useCallback(
    (evt) => {
      console.error(evt?.error ?? evt)
      if (evt?.sourceId || loadedRef.current) return
      setBasemapFailed(true)
    },
    [setBasemapFailed]
  )

  return { basemapFailed, onLoad, onError }
}

export function MapView({ layerData, heatmapComputeMs }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()
  const gpuBase = useGPUCapabilities()
  const { render, onDeviceInitialized, onError: onDeckError } = useRenderHealth()
  const { basemapFailed, onLoad: onMapLoad, onError: onMapError } = useBasemapHealth()
  const renderDevice = useMemo(
    () => (render.type ? { type: render.type, renderer: render.renderer } : null),
    [render.type, render.renderer]
  )
  const renderStatus = render.status
  const { frameTime, frameHistory } = useFrameTime()
  const { throughput: gpuThroughput, supported: benchSupported, running: benchRunning, run: runBenchmark } =
    useGPUCompute()

  const activePointCount =
    (layerVisibility.airports ? (layerData.airports?.length ?? 0) : 0) +
    (layerVisibility.ports    ? (layerData.ports?.length ?? 0)    : 0) +
    (layerData.stressPoints?.length ?? 0)

  const capabilities = useMemo(
    () => ({ ...gpuBase, renderDevice, renderStatus, activePointCount, frameTime, frameHistory, gpuThroughput, heatmapComputeMs }),
    [gpuBase, renderDevice, renderStatus, activePointCount, frameTime, frameHistory, gpuThroughput, heatmapComputeMs]
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
        onLoad={onMapLoad}
        onError={onMapError}
      >
        <DeckGLOverlay layers={layers} onDeviceInitialized={onDeviceInitialized} onError={onDeckError} />
      </Map>
      <div className="map-vignette" />
      {basemapFailed ? (
        <div className="basemap-fallback" role="status">
          <span className="basemap-fallback-title">BASEMAP UNAVAILABLE</span>
          <span className="basemap-fallback-sub">DATA LAYERS STILL SHOWN</span>
        </div>
      ) : null}
      <GPUInfoPanel capabilities={capabilities} benchmark={benchmark} />
    </div>
  )
}