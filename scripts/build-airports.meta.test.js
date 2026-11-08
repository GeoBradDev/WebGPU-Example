// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildMeta, SOURCE_SHA, SOURCE_URL } from './build-airports.mjs'

// Issue #9 review B1: fetchedAt was a bare UTC date with no zone marker.
describe('buildMeta', () => {
  const counts = { total: 2, included: 1, droppedType: 1, droppedCoords: 0, byType: {}, inputByType: {} }

  it('records fetchedAt as the full ISO timestamp in UTC', () => {
    const now = new Date('2026-11-07T23:30:05.123-06:00')
    const meta = buildMeta({ counts, sourceBytes: 10, outputBytes: 5, now })
    expect(meta.fetchedAt).toBe('2026-11-08T05:30:05.123Z')
  })

  it('keeps the pinned source, license, counts, and sizes', () => {
    const meta = buildMeta({ counts, sourceBytes: 10, outputBytes: 5, now: new Date(0) })
    expect(meta).toMatchObject({
      source: 'OurAirports',
      sourceUrl: SOURCE_URL,
      commit: SOURCE_SHA,
      license: 'Public domain (OurAirports data)',
      licenseUrl: 'https://ourairports.com/data/',
      counts,
      rounding: '3 decimal places',
      bytes: { source: 10, output: 5 },
    })
  })
})
