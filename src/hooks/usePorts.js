import { useState, useEffect, useCallback } from 'react'
import { WORLD_PORTS_URL } from '../config/sources.js'

/**
 * Fetches the bundled World Port Index GeoJSON on mount and on each retry.
 * Parses Point features into a flat array.
 *
 * Returns { ports, loaded, error, retry }
 *   ports  - Array<{ lon: number, lat: number, name: string }>
 *   loaded - true after successful parse
 *   error  - Error if fetch failed, null otherwise
 *   retry  - stable function that refetches after a failure
 */
export function usePorts() {
  const [ports, setPorts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  // Bumped by retry to run the load effect again (issue #10).
  const [attempt, setAttempt] = useState(0)

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
    // Also guards a request superseded by a retry.
    return () => { cancelled = true }
  }, [attempt])

  // Called from an event handler: clears the error, shows loading again, and
  // refetches the same URL. Stable across renders.
  const retry = useCallback(() => {
    setError(null)
    setLoaded(false)
    setAttempt((a) => a + 1)
  }, [])

  return { ports, loaded, error, retry }
}
