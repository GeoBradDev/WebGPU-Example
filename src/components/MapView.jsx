import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { webgpuAdapter } from '@luma.gl/webgpu'

import { buildLayers } from '../layers/index.js'
import { useMapStore } from '../store/mapStore.js'
import { BASEMAP_STYLE } from '../config/sources.js'
import { useGPUCapabilities } from '../hooks/useGPUCapabilities.js'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

function DeckGLOverlay({ layers }) {
  const overlay = useControl(
    () => new MapboxOverlay({
      interleaved: false,
      deviceProps: { type: 'webgpu', adapters: [webgpuAdapter] },
    }),
    { position: 'top-left' }
  )

  useEffect(() => {
    overlay.setProps({ layers })
  }, [overlay, layers])

  return null
}

function useFrameTime() {
  const [frameTime, setFrameTime] = useState(0)
  // eslint-disable-next-line react-hooks/purity
  const lastRef = useRef(performance.now())

  useEffect(() => {
    let rafId
    function tick(now) {
      setFrameTime(Math.round(now - lastRef.current))
      lastRef.current = now
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return frameTime
}

export function MapView({ layerData }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()
  const gpuBase = useGPUCapabilities()
  const frameTime = useFrameTime()

  const activePointCount = layerVisibility.points ? (layerData.points?.length ?? 0) : 0

  const capabilities = useMemo(
    () => ({ ...gpuBase, activePointCount, frameTime }),
    [gpuBase, activePointCount, frameTime]
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
        <DeckGLOverlay layers={layers} />
      </Map>
      <div className="map-vignette" />
      <GPUInfoPanel capabilities={capabilities} />
    </div>
  )
}