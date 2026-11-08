import { useState, useEffect, useCallback } from 'react'
import { OURAIRPORTS_CSV_URL } from '../config/sources.js'

/**
 * Parses a single CSV row, respecting double-quoted fields that may contain commas.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVRow(line) {
  const result = []
  let inQuotes = false
  let current = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 2
        continue
      }
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
    i++
  }
  result.push(current)
  return result
}

/**
 * Parses OurAirports airports.csv text.
 * Filters out closed airports and rows with missing coordinates.
 * Field order: id(0), ident(1), type(2), name(3), latitude_deg(4), longitude_deg(5)
 *
 * @param {string} text - raw CSV text including header row
 * @returns {Array<{ lon: number, lat: number, name: string, type: string }>}
 */
export function parseAirportCSV(text) {
  const lines = text.split('\n')
  const result = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const fields = parseCSVRow(line)
    const type = fields[2]
    if (type === 'closed') continue
    const lat = parseFloat(fields[4])
    const lon = parseFloat(fields[5])
    if (!isFinite(lat) || !isFinite(lon)) continue
    result.push({ lon, lat, name: fields[3], type })
  }
  return result
}

/**
 * Fetches and parses the OurAirports CSV on mount and on each retry.
 *
 * Returns { airports, loaded, error, retry }
 *   airports - Array<{ lon, lat, name, type }>
 *   loaded   - true after successful fetch
 *   error    - Error if fetch failed, null otherwise
 *   retry    - stable function that refetches after a failure
 */
export function useAirports() {
  const [airports, setAirports] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  // Bumped by retry to run the load effect again (issue #10).
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(OURAIRPORTS_CSV_URL)
        if (!res.ok) throw new Error(`Airport fetch failed: ${res.status} ${res.statusText}`)
        const text = await res.text()
        if (cancelled) return
        setAirports(parseAirportCSV(text))
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

  return { airports, loaded, error, retry }
}