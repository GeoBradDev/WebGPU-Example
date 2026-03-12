import { useState, useEffect } from 'react'
import { WORLD_PORTS_URL } from '../config/sources.js'

/**
 * Fetches the bundled World Port Index GeoJSON once on mount.
 * Parses Point features into a flat array.
 *
 * Returns { ports, loaded, error }
 *   ports  - Array<{ lon: number, lat: number, name: string }>
 *   loaded - true after successful parse
 *   error  - Error if fetch failed, null otherwise
 */
export function usePorts() {
  const [ports, setPorts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(WORLD_PORTS_URL)
        if (!res.ok) throw new Error(`Ports fetch failed: ${res.status} ${res.statusText}`)
        const geojson = await res.json()
        if (cancelled) return
        const parsed = geojson.features
          .filter((f) => f.geometry?.type === 'Point')
          .map((f) => ({
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
            // NGA WPI uses PORT_NAME; fall back to name for other datasets
            name: f.properties?.PORT_NAME ?? f.properties?.name ?? '',
          }))
          .filter((p) => isFinite(p.lon) && isFinite(p.lat))
        setPorts(parsed)
        setLoaded(true)
      } catch (err) {
        if (!cancelled) setError(err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { ports, loaded, error }
}
