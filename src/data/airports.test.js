import { describe, it, expect } from 'vitest'
import { decodeAirports, selectMajorAirports } from './airports.js'

const TYPES = ['large_airport', 'medium_airport', 'small_airport']
const VALID = {
  version: 1,
  types: TYPES,
  lon: [-118.408, -87.905, 20],
  lat: [33.943, 41.979, 10.001],
  name: ['LAX', 'ORD', 'Strip'],
  type: [0, 1, 2],
}

describe('decodeAirports', () => {
  it('decodes columns into { lon, lat, name, type } rows in order', () => {
    expect(decodeAirports(VALID)).toEqual([
      { lon: -118.408, lat: 33.943, name: 'LAX', type: 'large_airport' },
      { lon: -87.905, lat: 41.979, name: 'ORD', type: 'medium_airport' },
      { lon: 20, lat: 10.001, name: 'Strip', type: 'small_airport' },
    ])
  })

  it('throws on columns of unequal length', () => {
    expect(() => decodeAirports({ ...VALID, lat: [1, 2] })).toThrow('Airport data is malformed')
  })

  it('throws when a column is not an array', () => {
    expect(() => decodeAirports({ ...VALID, name: 'LAX' })).toThrow('Airport data is malformed')
    expect(() => decodeAirports({ ...VALID, types: undefined })).toThrow('Airport data is malformed')
  })

  it('throws on a non-object body', () => {
    expect(() => decodeAirports(null)).toThrow('Airport data is malformed')
    expect(() => decodeAirports('id,ident,type\n')).toThrow('Airport data is malformed')
  })

  it('skips rows with an unknown type index', () => {
    const rows = decodeAirports({ ...VALID, type: [0, 7, -1] })
    expect(rows.map((r) => r.name)).toEqual(['LAX'])
  })

  it('skips rows with non-finite coordinates', () => {
    const rows = decodeAirports({ ...VALID, lon: [null, -87.905, 'x'], lat: [33.943, Infinity, 10] })
    expect(rows).toEqual([])
  })
})

describe('selectMajorAirports', () => {
  it('keeps only large and medium airports, in order', () => {
    const rows = decodeAirports({
      ...VALID,
      lon: [1, 2, 3, 4],
      lat: [1, 2, 3, 4],
      name: ['S1', 'M1', 'L1', 'S2'],
      type: [2, 1, 0, 2],
    })
    expect(selectMajorAirports(rows).map((r) => r.name)).toEqual(['M1', 'L1'])
  })

  it('returns an empty array for no airports', () => {
    expect(selectMajorAirports([])).toEqual([])
  })
})
