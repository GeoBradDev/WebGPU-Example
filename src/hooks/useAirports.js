import { useState, useEffect, useCallback } from 'react'
import { AIRPORTS_DATA_URL } from '../config/sources.js'
import { decodeAirports, selectMajorAirports } from '../data/airports.js'

const EMPTY = { airports: [], majorAirports: [] }

/**
 * Fetches and decodes the bundled airports JSON on mount and on each retry.
 *
 * Returns { airports, majorAirports, loaded, error, retry }
 *   airports      - Array<{ lon, lat, name, type }>, all included airports (heatmap set)
 *   majorAirports - the large and medium subset drawn as points, computed once per load
 *   loaded        - true after a successful load
 *   error         - Error if the fetch or decode failed, null otherwise
 *   retry         - stable function that refetches after a failure
 */
export function useAirports() {
  // Both lists are set together so majorAirports is derived once per load,
  // not on every render.
  const [data, setData] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  // Bumped by retry to run the load effect again (issue #10).
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(AIRPORTS_DATA_URL)
        if (!res.ok) throw new Error(`Airport fetch failed: ${res.status} ${res.statusText}`)
        const json = await res.json()
        if (cancelled) return
        const airports = decodeAirports(json)
        setData({ airports, majorAirports: selectMajorAirports(airports) })
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

  return { airports: data.airports, majorAirports: data.majorAirports, loaded, error, retry }
}
