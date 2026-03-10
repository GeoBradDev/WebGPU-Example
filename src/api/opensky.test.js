import { describe, it, expect } from 'vitest'
import { buildBinaryTracks } from './opensky.js'

describe('buildBinaryTracks', () => {
  it('returns empty binary for an empty map', () => {
    const result = buildBinaryTracks(new Map())
    expect(result.length).toBe(0)
    expect(result.startIndices).toBeInstanceOf(Uint32Array)
    expect(result.startIndices.length).toBe(1)
    expect(result.startIndices[0]).toBe(0)
    expect(result.attributes.getPath.value).toBeInstanceOf(Float32Array)
    expect(result.attributes.getPath.value.length).toBe(0)
    expect(result.attributes.getPath.size).toBe(2)
  })

  it('excludes single-point tracks (PathLayer requires 2+ vertices)', () => {
    const map = new Map([['abc123', [[10, 20]]]])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(0)
    expect(result.attributes.getPath.value.length).toBe(0)
  })

  it('encodes a single two-point track', () => {
    const map = new Map([['abc123', [[10, 20], [11, 21]]]])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(1)
    expect(result.startIndices).toEqual(new Uint32Array([0, 2]))
    expect(result.attributes.getPath.value).toEqual(new Float32Array([10, 20, 11, 21]))
  })

  it('encodes two tracks with correct startIndices', () => {
    const map = new Map([
      ['abc', [[0, 0], [1, 1], [2, 2]]],
      ['def', [[10, 10], [11, 11]]],
    ])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(2)
    // startIndices has length + 1 entries: [0, 3, 5]
    expect(result.startIndices).toEqual(new Uint32Array([0, 3, 5]))
    // (3 + 2) vertices * 2 components = 10 floats
    expect(result.attributes.getPath.value.length).toBe(10)
    expect(result.attributes.getPath.value[0]).toBe(0)   // first path, first lng
    expect(result.attributes.getPath.value[1]).toBe(0)   // first path, first lat
    expect(result.attributes.getPath.value[6]).toBe(10)  // second path, first lng
    expect(result.attributes.getPath.value[7]).toBe(10)  // second path, first lat
  })

  it('skips single-point tracks when mixed with valid tracks', () => {
    const map = new Map([
      ['solo', [[5, 5]]],
      ['pair', [[1, 2], [3, 4]]],
    ])
    const result = buildBinaryTracks(map)
    expect(result.length).toBe(1)
    expect(result.attributes.getPath.value).toEqual(new Float32Array([1, 2, 3, 4]))
  })
})