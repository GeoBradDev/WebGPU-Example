import { AISSTREAM_WS_URL, AISSTREAM_BOUNDING_BOX } from '../config/sources.js'

/**
 * Opens a WebSocket connection to aisstream.io and subscribes to global
 * PositionReport messages. Returns the WebSocket instance — caller is
 * responsible for closing it.
 *
 * @param {string} apiKey - VITE_AISSTREAM_API_KEY
 * @param {function} onMessage - called with each parsed JSON message
 * @param {function} onError - called on WebSocket error
 * @param {function} onOpen - called when connection is established
 * @param {function} onClose - called when connection closes
 */
export function createAISStream({ apiKey, onMessage, onError, onOpen, onClose }) {
  const ws = new WebSocket(AISSTREAM_WS_URL)

  ws.onopen = () => {
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: AISSTREAM_BOUNDING_BOX,
      FilterMessageTypes: ['PositionReport'],
    }))
    onOpen?.()
  }

  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data))
    } catch {
      // malformed frame — skip silently
    }
  }

  ws.onerror = () => onError?.(new Error('AIS WebSocket error'))
  ws.onclose = () => onClose?.()

  return ws
}