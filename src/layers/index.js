import { ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers'

/**
 * Builds the deck.gl layer array from current visibility and data state.
 * @param {Object} layerVisibility - { points: bool, adsb: bool }
 * @param {Object} data - { points: Array<GeoJSONFeature>, adsbTracks: BinaryPathData, adsbPositions: Array<AircraftPosition> }
 * @param {Function} onFeatureClick - called with the clicked feature object
 */
export function buildLayers(layerVisibility, data, onFeatureClick) {
  const layers = []

  if (layerVisibility.points) {
    layers.push(
      new ScatterplotLayer({
        id: 'ais-vessels',
        data: data.points ?? [],
        getPosition: (d) => d.geometry.coordinates,
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: [255, 140, 0, 200],
        pickable: true,
        onClick: ({ object }) => object && onFeatureClick(object),
      })
    )
  }

  if (layerVisibility.adsb) {
    layers.push(
      new PathLayer({
        id: 'adsb-tracks',
        data: data.adsbTracks,
        _pathType: 'open',
        getWidth: 1,
        widthUnits: 'pixels',
        getColor: [0, 180, 255, 160],
      }),
      new TextLayer({
        id: 'adsb-icons',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getText: () => '✈',
        // ✈ points right by default; +90° offset aligns it to north, then subtract heading
        getAngle: (d) => 90 - (d.heading ?? 0),
        getSize: 14,
        getColor: [0, 220, 255, 220],
        billboard: false,
        pickable: true,
        // Wrap in { properties } so FeaturePopup renders key/value pairs correctly
        onClick: ({ object }) => object && onFeatureClick({ properties: object }),
      }),
      new TextLayer({
        id: 'adsb-labels',
        data: data.adsbPositions ?? [],
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => [d.callsign, d.country].filter(Boolean).join('\n'),
        getSize: 10,
        getColor: [0, 220, 255, 160],
        getPixelOffset: [0, 14],
        billboard: false,
        pickable: false,
      })
    )
  }

  return layers
}