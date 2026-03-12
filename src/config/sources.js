// Airport data - OurAirports public domain CSV. GitHub raw serves with permissive CORS.
export const OURAIRPORTS_CSV_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv'

// Sea ports: bundled static GeoJSON asset (NGA World Port Index, public domain)
export const WORLD_PORTS_URL = '/data/ports.geojson'

export const LAYERS = {
  AIRPORTS: { id: 'airports', label: 'Airports' },
  PORTS:    { id: 'ports',    label: 'Sea Ports' },
}

// Free dark vector basemap - no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center - global view
export const DEFAULT_VIEW = {
  longitude: 0,
  latitude: 20,
  zoom: 2,
}