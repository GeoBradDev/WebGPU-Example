import axios from 'axios'

const GEOSERVER_BASE_URL = import.meta.env.VITE_GEOSERVER_URL ?? 'http://localhost:8080/geoserver'

export const geoserverClient = axios.create({
  baseURL: GEOSERVER_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Auth interceptor slot — fill in when needed (Basic Auth or Bearer token).
geoserverClient.interceptors.request.use((config) => {
  // const token = getAuthToken()
  // if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * Builds a WFS GetFeature query string for the given type name.
 * @param {string} typeName - e.g. 'myWorkspace:myLayer'
 * @param {string} [cqlFilter] - optional CQL filter string
 */
export function buildWfsUrl(typeName, cqlFilter) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName,
    outputFormat: 'application/json',
  })
  if (cqlFilter) params.set('CQL_FILTER', cqlFilter)
  return `?${params.toString()}`
}

/**
 * Fetches a WFS layer as GeoJSON FeatureCollection.
 * @param {string} typeName
 * @param {string} [cqlFilter]
 */
export async function fetchWfsLayer(typeName, cqlFilter) {
  const url = buildWfsUrl(typeName, cqlFilter)
  const response = await geoserverClient.get(url)
  return response.data
}