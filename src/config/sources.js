// GeoServer layer type names — update to match your workspace and layer names.
export const LAYERS = {
  POINTS: {
    id: 'points',
    typeName: 'myWorkspace:myPoints',
    label: 'Points',
  },
  POLYGONS: {
    id: 'polygons',
    typeName: 'myWorkspace:myPolygons',
    label: 'Polygons',
  },
}

// Free dark vector basemap — no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center and zoom
export const DEFAULT_VIEW = {
  longitude: 119.4179,
  latitude: 24.3963,
  zoom: 6,
}