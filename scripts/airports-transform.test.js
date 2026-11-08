import { describe, it, expect } from 'vitest'
import {
  parseCSV,
  transformAirports,
  INCLUDED_TYPES,
  EXCLUDED_TYPES,
} from './airports-transform.js'

describe('parseCSV', () => {
  it('splits plain rows and fields', () => {
    expect(parseCSV('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCSV('x,"City of, State",y')).toEqual([['x', 'City of, State', 'y']])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(parseCSV('"O""Hare",1')).toEqual([['O"Hare', '1']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCSV('"line one\nline two",2\n3,4')).toEqual([
      ['line one\nline two', '2'],
      ['3', '4'],
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles no trailing newline', () => {
    expect(parseCSV('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCSV('﻿a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps empty fields', () => {
    expect(parseCSV('a,,c\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })
})

// Columns deliberately not in the upstream order, to prove header mapping.
const HEADER = 'longitude_deg,name,id,type,latitude_deg'
const FIXTURE = '﻿' + [
  HEADER,
  '-118.40812,Los Angeles International Airport,1,large_airport,33.94254',
  '-87.9048,"O""Hare International",2,medium_airport,41.9786',
  '20.00049,"City of, State Airport",3,small_airport,10.00051',
  '0,Closed Field,4,closed,0',
  '1,Some Heliport,5,heliport,1',
  '2,Lake Base,6,seaplane_base,2',
  '3,Balloon Park,7,balloonport,3',
  '4,"Two\nLine Strip",8,small_airport,4',
  '5,No Lat,9,small_airport,',
  '6,Bad Lat,10,small_airport,abc',
  '200,Out Of Range,11,small_airport,5',
  '7,Future Type,12,spaceport,7',
].join('\r\n') + '\r\n'

describe('transformAirports', () => {
  it('exports the include and exclude lists from the plan', () => {
    expect(INCLUDED_TYPES).toEqual(['large_airport', 'medium_airport', 'small_airport'])
    expect(EXCLUDED_TYPES).toEqual(['closed', 'heliport', 'seaplane_base', 'balloonport'])
  })

  it('keeps only included types with valid coordinates, in input order', () => {
    const { data } = transformAirports(FIXTURE)
    expect(data.name).toEqual([
      'Los Angeles International Airport',
      'O"Hare International',
      'City of, State Airport',
      'Two\nLine Strip',
    ])
  })

  it('writes the columnar schema with type indexes into types', () => {
    const { data } = transformAirports(FIXTURE)
    expect(data.version).toBe(1)
    expect(data.types).toEqual(INCLUDED_TYPES)
    expect(data.type).toEqual([0, 1, 2, 2])
    expect(data.lon).toHaveLength(4)
    expect(data.lat).toHaveLength(4)
  })

  it('rounds coordinates to 3 decimal places', () => {
    const { data } = transformAirports(FIXTURE)
    expect(data.lon[0]).toBe(-118.408)
    expect(data.lat[0]).toBe(33.943)
    expect(data.lon[2]).toBe(20)
    expect(data.lat[2]).toBe(10.001)
  })

  it('counts rows per stage and per type', () => {
    const { counts } = transformAirports(FIXTURE)
    expect(counts).toEqual({
      total: 12,
      included: 4,
      droppedType: 5,
      droppedCoords: 3,
      byType: {
        large_airport: 1,
        medium_airport: 1,
        small_airport: 2,
      },
      inputByType: {
        large_airport: 1,
        medium_airport: 1,
        small_airport: 5,
        closed: 1,
        heliport: 1,
        seaplane_base: 1,
        balloonport: 1,
        spaceport: 1,
      },
    })
  })

  it('throws a clear error when a required header is missing', () => {
    expect(() => transformAirports('id,type,name,latitude_deg\n1,large_airport,X,1\n')).toThrow(
      /missing required column: longitude_deg/
    )
  })

  it('ignores blank lines', () => {
    const { counts } = transformAirports('type,name,latitude_deg,longitude_deg\n\nlarge_airport,A,1,2\n\n')
    expect(counts.total).toBe(1)
    expect(counts.included).toBe(1)
  })
})
