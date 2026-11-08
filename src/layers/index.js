import { ScatterplotLayer, BitmapLayer } from '@deck.gl/layers'
import { HEATMAP_BOUNDS } from './heatmapProjection.js'

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
        getRadius: 5,
        radiusUnits: 'pixels',
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
        getRadius: 5,
        radiusUnits: 'pixels',
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