import { useCallback, useEffect, useMemo } from 'react'
import Map from 'react-map-gl/maplibre'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { webgpuAdapter } from '@luma.gl/webgpu'

import { buildLayers } from '../layers/index.js'
import { useMapStore } from '../store/mapStore.js'
import { BASEMAP_STYLE } from '../config/sources.js'

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

export function MapView({ layerData }) {
  const { viewport, setViewport, layerVisibility, setSelectedFeature } = useMapStore()

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
    </div>
  )
}