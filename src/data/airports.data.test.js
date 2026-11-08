// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeAirports, selectMajorAirports } from './airports.js'

// Sanity checks on the committed snapshot (issue #9). Reads from disk only.
const DATA_URL = new URL('../../public/data/airports.json', import.meta.url)
const META_URL = new URL('../../public/data/airports.meta.json', import.meta.url)
const raw = readFileSync(DATA_URL)
const json = JSON.parse(raw.toString('utf8'))
const meta = JSON.parse(readFileSync(META_URL, 'utf8'))

describe('public/data/airports.json', () => {
  it('stays under 2.2 MB uncompressed', () => {
    expect(raw.byteLength).toBeLessThan(2.2 * 1024 * 1024)
  })

  it('has only the three included types and equal-length columns', () => {
    expect(json.types).toEqual(['large_airport', 'medium_airport', 'small_airport'])
    for (const key of ['lat', 'name', 'type']) expect(json[key]).toHaveLength(json.lon.length)
  })

  it('decodes every row, more than 40,000 of them', () => {
    const rows = decodeAirports(json)
    expect(rows.length).toBe(json.lon.length)
    expect(rows.length).toBeGreaterThan(40000)
  })

  it('matches the counts recorded in the meta file', () => {
    const rows = decodeAirports(json)
    expect(rows.length).toBe(meta.counts.included)
    expect(selectMajorAirports(rows).length).toBe(
      meta.counts.byType.large_airport + meta.counts.byType.medium_airport
    )
    expect(meta.commit).toBe('64af12951161ed52bc733eb4101224643c48850a')
    expect(meta.sourceUrl).toContain(meta.commit)
  })
})
