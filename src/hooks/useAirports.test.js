import { describe, it, expect } from 'vitest'
import { parseAirportCSV } from './useAirports.js'

const SAMPLE_CSV = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent',
  '1,KLAX,large_airport,Los Angeles International Airport,33.9425,-118.4081,125,NA',
  '2,KSFO,large_airport,San Francisco International Airport,37.6188,-122.3750,13,NA',
  '3,ZZZZ,closed,Closed Airport,0.0,0.0,0,NA',
  '4,KABC,small_airport,"City of, State Airport",10.0,20.0,100,NA',
].join('\n')

describe('parseAirportCSV', () => {
  it('returns an array', () => {
    expect(Array.isArray(parseAirportCSV(SAMPLE_CSV))).toBe(true)
  })

  it('filters out closed airports', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result.every((a) => a.type !== 'closed')).toBe(true)
  })

  it('parses lon and lat as numbers', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].lon).toBe(-118.4081)
    expect(result[0].lat).toBe(33.9425)
  })

  it('parses name and type strings', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    expect(result[0].name).toBe('Los Angeles International Airport')
    expect(result[0].type).toBe('large_airport')
  })

  it('handles quoted names with embedded commas', () => {
    const result = parseAirportCSV(SAMPLE_CSV)
    const quoted = result.find((a) => a.name === 'City of, State Airport')
    expect(quoted).toBeDefined()
  })

  it('handles RFC 4180 doubled-quote escape inside quoted field', () => {
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft',
      '1,KORD,large_airport,"O""Hare International",41.9786,-87.9048,668',
    ].join('\n')
    const result = parseAirportCSV(csv)
    expect(result[0].name).toBe('O"Hare International')
  })

  it('filters rows with invalid lon/lat', () => {
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft',
      '1,XBAD,small_airport,Bad Airport,,20.0,0',
    ].join('\n')
    const result = parseAirportCSV(csv)
    expect(result).toHaveLength(0)
  })
})
