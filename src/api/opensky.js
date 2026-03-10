import { OPENSKY_URL } from '../config/sources.js'

/**
 * Fetches current aircraft state vectors from OpenSky Network (anonymous tier).
 * Filters out aircraft with null lat/lon.
 * Returns an array of normalized aircraft objects.
 * Throws on network error or non-2xx HTTP status.
 * Request is aborted after 10 seconds if not completed.
 *
 * @returns {Promise<Array<{icao24, callsign, country, lon, lat, velocity, heading}>>}
 */
export async function fetchOpenSky() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(OPENSKY_URL, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`OpenSky fetch failed: ${response.status} ${response.statusText}`)
    }
    const json = await response.json()
    if (!Array.isArray(json.states)) return []
    // OpenSky state vector field indices (see https://openskynetwork.github.io/opensky-api/rest.html)
    // [0] icao24, [1] callsign, [2] origin_country, [5] longitude, [6] latitude, [9] velocity (m/s), [10] true track (heading)
    return json.states
      .filter((s) => s[5] != null && s[6] != null) // loose equality catches both null and undefined
      .map((s) => ({
        icao24: s[0],
        callsign: s[1]?.trim() || null,
        country: s[2],
        lon: s[5],
        lat: s[6],
        velocity: s[9],
        heading: s[10],
      }))
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Transforms a Map<icao24, [lng, lat][]> into deck.gl binary PathLayer format.
 * Paths with fewer than 2 points are excluded (PathLayer requires at least 2 vertices).
 *
 * @param {Map<string, Array<[number, number]>>} trackMap
 * @returns {{ length: number, startIndices: Uint32Array, attributes: { getPath: { value: Float32Array, size: 2 } } }}
 */
export function buildBinaryTracks(trackMap) {
  const paths = []
  for (const track of trackMap.values()) {
    if (track.length >= 2) paths.push(track)
  }

  const totalVertices = paths.reduce((sum, p) => sum + p.length, 0)
  const positions = new Float32Array(totalVertices * 2)
  const startIndices = new Uint32Array(paths.length + 1)

  let vertexOffset = 0
  for (let i = 0; i < paths.length; i++) {
    startIndices[i] = vertexOffset
    for (const [lng, lat] of paths[i]) {
      positions[vertexOffset * 2] = lng
      positions[vertexOffset * 2 + 1] = lat
      vertexOffset++
    }
  }
  startIndices[paths.length] = vertexOffset

  return {
    length: paths.length,
    startIndices,
    attributes: {
      getPath: { value: positions, size: 2 },
    },
  }
}
