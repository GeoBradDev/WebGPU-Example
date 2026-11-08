import { ScatterplotLayer, BitmapLayer } from '@deck.gl/layers'
import { HEATMAP_BOUNDS } from './heatmapProjection.js'

const LARGE_AIRPORT_RADIUS_M = 12000
const MEDIUM_AIRPORT_RADIUS_M = 6000
const AIRPORT_RADIUS_MIN_PIXELS = 1.5
const AIRPORT_RADIUS_MAX_PIXELS = 8
const PORT_RADIUS_M = 6000
const PORT_RADIUS_MIN_PIXELS = 2
const PORT_RADIUS_MAX_PIXELS = 8

function getAirportRadius(d) {
  return d.type === 'large_airport' ? LARGE_AIRPORT_RADIUS_M : MEDIUM_AIRPORT_RADIUS_M
}

/**
 * Builds the deck.gl layer array from current visibility and data state.
 *
 * @param {Object} layerVisibility - { airports: bool, ports: bool, heatmap: bool }
 * @param {Object} data - { airports: Array, ports: Array, stressPoints: BinaryColumnarData|{}, heatmapCanvas: HTMLCanvasElement|null }
 * @param {Function} onFeatureClick - called with { properties: object } on click
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.heatmap && data.heatmapCanvas) {
    layers.push(
      new BitmapLayer({
        id: 'heatmap',
        bounds: HEATMAP_BOUNDS,
        image: data.heatmapCanvas,
        opacity: 0.6,
        fetch: (url) =>
          new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = url
          }),
      })
    )
  }

  if (layerVisibility.airports) {
    layers.push(
      new ScatterplotLayer({
        id: 'airports',
        data: data.airports ?? [],
        getPosition: (d) => [d.lon, d.lat],
        // Issue #9: size in meters so points grow with zoom; the pixel clamp
        // keeps them small enough at zoom 2 for basemap labels to stay legible
        // and big enough at high zoom to click.
        getRadius: getAirportRadius,
        radiusUnits: 'meters',
        radiusMinPixels: AIRPORT_RADIUS_MIN_PIXELS,
        radiusMaxPixels: AIRPORT_RADIUS_MAX_PIXELS,
        getFillColor: [255, 180, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      })
    )
  }

  if (layerVisibility.ports) {
    layers.push(
      new ScatterplotLayer({
        id: 'ports',
        data: data.ports ?? [],
        getPosition: (d) => [d.lon, d.lat],
        // Same treatment as airports (issue #9): small at zoom 2 so country
        // labels stay legible, clickable when zoomed in.
        getRadius: PORT_RADIUS_M,
        radiusUnits: 'meters',
        radiusMinPixels: PORT_RADIUS_MIN_PIXELS,
        radiusMaxPixels: PORT_RADIUS_MAX_PIXELS,
        getFillColor: [0, 255, 140, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      })
    )
  }

  if (data.stressPoints?.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'stress',
        data: data.stressPoints,
        getRadius: 1,
        radiusUnits: 'pixels',
        getFillColor: [0, 180, 255, 60],
        pickable: false,
      })
    )
  }

  return layers
}