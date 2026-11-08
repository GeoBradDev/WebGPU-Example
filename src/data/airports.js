// Decoder for the committed columnar airports file, public/data/airports.json
// (built by `npm run data:airports`, issue #9).

const MAJOR_TYPES = new Set(['large_airport', 'medium_airport'])
const COLUMNS = ['lon', 'lat', 'name', 'type']

function malformed() {
  return new Error('Airport data is malformed')
}

/**
 * Validates the columnar shape and returns one object per airport. Rows with
 * non-finite coordinates or an unknown type index are skipped.
 *
 * @param {{ types: string[], lon: number[], lat: number[], name: string[], type: number[] }} json
 * @returns {Array<{ lon: number, lat: number, name: string, type: string }>}
 */
export function decodeAirports(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.types)) throw malformed()
  const n = json.lon?.length
  for (const key of COLUMNS) {
    if (!Array.isArray(json[key]) || json[key].length !== n) throw malformed()
  }

  const { types, lon, lat, name, type } = json
  const out = []
  for (let i = 0; i < n; i++) {
    const t = types[type[i]]
    const x = lon[i]
    const y = lat[i]
    if (typeof t !== 'string' || typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({ lon: x, lat: y, name: String(name[i] ?? ''), type: t })
  }
  return out
}

/**
 * The airports drawn as points: large and medium only, in input order.
 *
 * @param {Array<{ type: string }>} airports
 */
export function selectMajorAirports(airports) {
  return airports.filter((a) => MAJOR_TYPES.has(a.type))
}
