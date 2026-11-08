// Pure transform from the OurAirports airports.csv text to the compact
// columnar JSON committed at public/data/airports.json (issue #9).
// No I/O and no Node globals, so it is unit tested in the normal suite.

export const INCLUDED_TYPES = ['large_airport', 'medium_airport', 'small_airport']
export const EXCLUDED_TYPES = ['closed', 'heliport', 'seaplane_base', 'balloonport']

const REQUIRED_COLUMNS = ['type', 'name', 'latitude_deg', 'longitude_deg']

/**
 * RFC 4180 CSV parser over the whole text: quoted fields with commas, doubled
 * quotes, and newlines; CRLF or LF row endings; optional trailing newline and
 * leading UTF-8 BOM.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else {
      field += ch
    }
    i++
  }
  // Last row without a trailing newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function round3(x) {
  return Math.round(x * 1000) / 1000
}

function parseCoord(s) {
  if (typeof s !== 'string' || s.trim() === '') return NaN
  return Number(s)
}

function isBlankRow(row) {
  return row.length === 1 && row[0] === ''
}

/**
 * @param {string} csvText - full airports.csv text, header row first
 * @returns {{ data: { version: number, types: string[], lon: number[], lat: number[], name: string[], type: number[] },
 *            counts: { total: number, included: number, droppedType: number, droppedCoords: number,
 *                      byType: Object<string, number>, inputByType: Object<string, number> } }}
 */
export function transformAirports(csvText) {
  const rows = parseCSV(csvText)
  const header = rows[0] ?? []
  const col = {}
  for (const name of REQUIRED_COLUMNS) {
    const idx = header.indexOf(name)
    if (idx === -1) throw new Error(`airports.csv is missing required column: ${name}`)
    col[name] = idx
  }

  const typeIndex = new Map(INCLUDED_TYPES.map((t, i) => [t, i]))
  const data = { version: 1, types: [...INCLUDED_TYPES], lon: [], lat: [], name: [], type: [] }
  const byType = Object.fromEntries(INCLUDED_TYPES.map((t) => [t, 0]))
  const inputByType = {}
  let total = 0
  let droppedType = 0
  let droppedCoords = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (isBlankRow(row)) continue
    total++
    const type = row[col.type] ?? ''
    inputByType[type] = (inputByType[type] ?? 0) + 1

    // Anything not explicitly included is dropped, including a new upstream type.
    const t = typeIndex.get(type)
    if (t === undefined) {
      droppedType++
      continue
    }
    const lat = parseCoord(row[col.latitude_deg])
    const lon = parseCoord(row[col.longitude_deg])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      droppedCoords++
      continue
    }
    data.lon.push(round3(lon))
    data.lat.push(round3(lat))
    data.name.push(row[col.name] ?? '')
    data.type.push(t)
    byType[type]++
  }

  return {
    data,
    counts: { total, included: data.type.length, droppedType, droppedCoords, byType, inputByType },
  }
}
