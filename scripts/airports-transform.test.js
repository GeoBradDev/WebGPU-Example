import { describe, it, expect } from 'vitest'
import {
  parseCSV,
  transformAirports,
  checkCounts,
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

// Issue #9 review F1: malformed quoting must fail loudly, not merge rows.
describe('parseCSV strictness', () => {
  it('throws on a quote inside an unquoted field, naming the line', () => {
    expect(() => parseCSV('a,b"c,d\n1,2,3\n')).toThrow(/line 1\b/)
  })

  it('throws on a character after a closing quote, naming the line', () => {
    expect(() => parseCSV('"abc"x,y\n')).toThrow(/line 1\b/)
  })

  it('throws on end of input inside a quoted field, naming the line it opened on', () => {
    expect(() => parseCSV('a,"unterminated\n1,2\n')).toThrow(/line 1\b/)
  })

  it('counts physical lines, including newlines inside quoted fields', () => {
    expect(() => parseCSV('"a\nb",1\nc"d,2\n')).toThrow(/line 3\b/)
    expect(() => parseCSV('a,b\r\n1,2\r\n3,"x"y\r\n')).toThrow(/line 3\b/)
  })

  it('still accepts a quoted field closed right before a delimiter, newline, or end', () => {
    expect(parseCSV('"a",b\n"c"\r\n"d"')).toEqual([['a', 'b'], ['c'], ['d']])
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

// Issue #9 review F1: the build script must not write an empty snapshot, and
// must surface upstream types it has never seen.
describe('checkCounts', () => {
  it('throws when no airports were included', () => {
    const { counts } = transformAirports('type,name,latitude_deg,longitude_deg\nheliport,H,1,2\n')
    expect(() => checkCounts(counts)).toThrow(/no airports/i)
  })

  it('lists input types that are neither included nor excluded', () => {
    const { counts } = transformAirports(FIXTURE)
    expect(checkCounts(counts)).toEqual({ unknownTypes: ['spaceport'] })
  })

  it('returns no unknown types for known input', () => {
    const { counts } = transformAirports('type,name,latitude_deg,longitude_deg\nlarge_airport,A,1,2\nclosed,C,1,2\n')
    expect(checkCounts(counts)).toEqual({ unknownTypes: [] })
  })
})

// Issue #9 review F2: a type named like an Object.prototype key must still be counted.
describe('transformAirports inputByType', () => {
  it('counts a __proto__ type as its own input type', () => {
    const { counts } = transformAirports(
      'type,name,latitude_deg,longitude_deg\nsmall_airport,A,1,2\n__proto__,B,1,2\nconstructor,C,1,2\n'
    )
    expect(counts.total).toBe(3)
    expect(Object.keys(counts.inputByType).sort()).toEqual(['__proto__', 'constructor', 'small_airport'])
    expect(counts.inputByType.__proto__).toBe(1)
    expect(counts.inputByType.constructor).toBe(1)
    expect(checkCounts(counts).unknownTypes.sort()).toEqual(['__proto__', 'constructor'])
  })
})
