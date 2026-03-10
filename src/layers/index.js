import { ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool, polygons: bool }
 * @param {Object} data - { points: Array, polygons: GeoJSON }
 * @param {Function} onFeatureClick - called with the clicked feature object
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.points) {
    layers.push(
      new ScatterplotLayer({
        id: 'points',
        data: data.points ?? [],
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: [255, 80, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  if (layerVisibility.polygons) {
    layers.push(
      new GeoJsonLayer({
        id: 'polygons',
        data: data.polygons ?? { type: 'FeatureCollection', features: [] },
        filled: true,
        stroked: true,
        getFillColor: [0, 100, 200, 80],
        getLineColor: [0, 60, 140, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  return layers
}