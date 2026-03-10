import { useState, useEffect, useRef } from 'react'
import { createAISStream } from '../api/ais.js'
import { AISSTREAM_FLUSH_INTERVAL } from '../config/sources.js'

/**
 * Connects to the aisstream.io WebSocket feed and accumulates vessel positions
 * by MMSI. State is flushed to React on a fixed interval to avoid re-rendering
 * on every incoming message (~300/s globally).
 *
 * Automatically reconnects after disconnection or connection timeout.
 *
 * Returns { vessels, connected, error }
 *   vessels   - array of GeoJSON Feature objects, one per unique MMSI seen
 *   connected - true while the WebSocket is open
 *   error     - Error if the connection failed, null otherwise
 */
export function useAIS() {
  const [vessels, setVessels] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const vesselMap = useRef(new Map())

  useEffect(() => {
    let destroyed = false
    let ws = null
    let reconnectTimer = null
    let connectTimeout = null

    function connect() {
      if (destroyed) return

      const apiKey = import.meta.env.VITE_AISSTREAM_API_KEY

      // If no onopen within 30s, close and retry (handles silent TCP hangs)
      connectTimeout = setTimeout(() => {
        if (ws) ws.close()
      }, 30_000)

      ws = createAISStream({
        apiKey,
        onOpen: () => {
          clearTimeout(connectTimeout)
          setConnected(true)
          setError(null)
        },
        onMessage: (msg) => {
          if (msg.MessageType !== 'PositionReport') return
          const { MMSI, ShipName, latitude, longitude } = msg.MetaData
          const { Sog, Cog, TrueHeading, NavigationalStatus } = msg.Message.PositionReport
          vesselMap.current.set(MMSI, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [longitude, latitude] },
            properties: {
              mmsi: MMSI,
              name: ShipName,
              sog: Sog,
              cog: Cog,
              heading: TrueHeading,
              navStat: NavigationalStatus,
            },
          })
        },
        onError: (err) => {
          clearTimeout(connectTimeout)
          setError(err)
        },
        onClose: () => {
          clearTimeout(connectTimeout)
          setConnected(false)
          if (!destroyed) {
            reconnectTimer = setTimeout(connect, 5_000)
          }
        },
      })
    }

    connect()

    const flushId = setInterval(() => {
      setVessels([...vesselMap.current.values()])
    }, AISSTREAM_FLUSH_INTERVAL)

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer)
      clearTimeout(connectTimeout)
      if (ws) ws.close()
      clearInterval(flushId)
    }
  }, [])

  return { vessels, connected, error }
}