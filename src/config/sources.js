// AIS data — aisstream.io global WebSocket feed. Requires VITE_AISSTREAM_API_KEY in .env.local
export const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream'
// Bounding box format: [[[lat, lon], [lat, lon]]] — latitude first (aisstream convention)
export const AISSTREAM_BOUNDING_BOX = [[[-90, -180], [90, 180]]]
// Flush accumulated vessel positions to React state at this interval (ms)
export const AISSTREAM_FLUSH_INTERVAL = 1_000

// ADS-B data — OpenSky Network anonymous REST feed. No auth required.
export const OPENSKY_URL = 'https://opensky-network.org/api/states/all'
// Anonymous tier minimum poll interval (registered accounts can use 5s)
export const OPENSKY_POLL_INTERVAL = 60_000
// Flush accumulated tracks to React state at this interval (ms)
export const OPENSKY_FLUSH_INTERVAL = 1_000
// Maximum position history per aircraft (rolling window, oldest dropped)
export const OPENSKY_MAX_TRACK_POINTS = 20

export const LAYERS = {
  AIS: {
    id: 'points',
    label: 'AIS Vessels',
  },
  ADSB: {
    id: 'adsb',
    label: 'ADS-B Aircraft',
  },
}

// Free dark vector basemap — no API key required.
export const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Default map center
export const DEFAULT_VIEW = {
  longitude: 119.4179,
  latitude: 24.3963,
  zoom: 6,
}