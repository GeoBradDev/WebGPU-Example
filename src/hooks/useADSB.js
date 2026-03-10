import { useState, useEffect, useRef } from 'react'
import { fetchOpenSky, buildBinaryTracks } from '../api/opensky.js'
import {
  OPENSKY_POLL_INTERVAL,
  OPENSKY_FLUSH_INTERVAL,
  OPENSKY_MAX_TRACK_POINTS,
} from '../config/sources.js'

const EMPTY_BINARY = buildBinaryTracks(new Map())

/**
 * Connects to OpenSky Network and accumulates aircraft track history by ICAO24.
 * State is flushed to React on a fixed interval to decouple rendering from polling.
 *
 * Returns { binaryTracks, currentPositions, connected, error }
 *   binaryTracks     - deck.gl binary PathLayer format (Float32Array + Uint32Array)
 *   currentPositions - array of { icao24, callsign, lon, lat, velocity, heading }
 *   connected        - true after the first successful poll
 *   error            - Error if the last poll failed, null otherwise
 */
export function useADSB() {
  const [binaryTracks, setBinaryTracks] = useState(EMPTY_BINARY)
  const [currentPositions, setCurrentPositions] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  const trackMap = useRef(new Map())
  const latestPositions = useRef([])

  useEffect(() => {
    let destroyed = false

    async function poll() {
      try {
        const aircraft = await fetchOpenSky()
        if (destroyed) return
        setConnected(true)
        setError(null)
        latestPositions.current = aircraft
        for (const a of aircraft) {
          const track = trackMap.current.get(a.icao24) ?? []
          track.push([a.lon, a.lat])
          if (track.length > OPENSKY_MAX_TRACK_POINTS) track.shift()
          trackMap.current.set(a.icao24, track)
        }
      } catch (err) {
        if (!destroyed) setError(err)
      }
    }

    poll()
    const pollId = setInterval(poll, OPENSKY_POLL_INTERVAL)

    const flushId = setInterval(() => {
      if (destroyed) return
      setBinaryTracks(buildBinaryTracks(trackMap.current))
      setCurrentPositions([...latestPositions.current])
    }, OPENSKY_FLUSH_INTERVAL)

    return () => {
      destroyed = true
      clearInterval(pollId)
      clearInterval(flushId)
    }
  }, [])

  return { binaryTracks, currentPositions, connected, error }
}
