import { describe, it, expect } from 'vitest'
import {
  MERCATOR_MAX_LAT,
  HEATMAP_GRID_W,
  HEATMAP_GRID_H,
  HEATMAP_BOUNDS,
  mercatorY,
  latToRowFraction,
  latToRow,
  lonToCol,
  binningWGSL,
} from './heatmapProjection.js'

// Independent reference math, written here so the test does not trust the module.
const DEG = Math.PI / 180
const refMercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))
const refInvMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG

/**
 * The latitude band a BitmapLayer draws image row `row` over, when the image
 * is stretched linearly in Mercator Y across [south, north] (deck.gl default
 * image coordinate system for a non-geospatial-reprojected bitmap).
 */
function rowBand(row, bounds, gridH) {
  const yTop = refMercY(bounds[3])
  const yBottom = refMercY(bounds[1])
  const step = (yTop - yBottom) / gridH
  const north = refInvMercY(yTop - row * step)
  const south = refInvMercY(yTop - (row + 1) * step)
  return { north, south }
}

describe('heatmapProjection constants', () => {
  it('uses the Web Mercator latitude limit', () => {
    expect(MERCATOR_MAX_LAT).toBe(85.051129)
  })

  it('keeps the existing grid size', () => {
    expect(HEATMAP_GRID_W).toBe(1024)
    expect(HEATMAP_GRID_H).toBe(512)
  })

  it('bounds span the full Mercator world', () => {
    expect(HEATMAP_BOUNDS).toEqual([-180, -MERCATOR_MAX_LAT, 180, MERCATOR_MAX_LAT])
  })

  it('mercatorY matches the reference formula', () => {
    for (const lat of [-80, -33.9, 0, 40, 65, 80]) {
      expect(mercatorY(lat)).toBeCloseTo(refMercY(lat), 10)
    }
  })

  it('the Mercator limit is the latitude whose Mercator Y is pi', () => {
    expect(mercatorY(MERCATOR_MAX_LAT)).toBeCloseTo(Math.PI, 5)
  })
})

describe('latToRow agrees with a Mercator-stretched bitmap (criterion 1a)', () => {
  it('equator lands on the middle rows', () => {
    expect(latToRowFraction(0)).toBeCloseTo(0.5, 10)
    expect(latToRow(0)).toBe(HEATMAP_GRID_H / 2)
  })

  it('reference latitudes fall inside the band their row is drawn over', () => {
    for (const lat of [0, 40, 60, 65, -33.9]) {
      const row = latToRow(lat)
      const { north, south } = rowBand(row, HEATMAP_BOUNDS, HEATMAP_GRID_H)
      expect(lat).toBeLessThanOrEqual(north + 1e-9)
      expect(lat).toBeGreaterThanOrEqual(south - 1e-9)
    }
  })

  it('65N maps to a row far from what the old linear mapping gave', () => {
    // Old: floor((90 - 65) / 180 * 512) = 71. Under Mercator it is much nearer the top.
    const oldRow = Math.floor(((90 - 65) / 180) * HEATMAP_GRID_H)
    expect(oldRow).toBe(71)
    expect(latToRow(65)).not.toBe(oldRow)
    const { north, south } = rowBand(oldRow, HEATMAP_BOUNDS, HEATMAP_GRID_H)
    // The old row is drawn north of 65N, which is the reported shift.
    expect(south).toBeGreaterThan(65)
    expect(north).toBeGreaterThan(65)
  })

  it('every latitude in [-80, 80] lands in the band its row is drawn over', () => {
    for (let lat = -80; lat <= 80; lat += 0.05) {
      const row = latToRow(lat)
      const { north, south } = rowBand(row, HEATMAP_BOUNDS, HEATMAP_GRID_H)
      expect(lat).toBeLessThanOrEqual(north + 1e-9)
      expect(lat).toBeGreaterThanOrEqual(south - 1e-9)
    }
  })

  it('rows increase monotonically southward', () => {
    let prev = -1
    for (let lat = 85; lat >= -85; lat -= 0.5) {
      const row = latToRow(lat)
      expect(row).toBeGreaterThanOrEqual(prev)
      prev = row
    }
  })
})

describe('clamping (criterion 2c)', () => {
  it('latitudes at or beyond the north limit clamp to row 0', () => {
    for (const lat of [MERCATOR_MAX_LAT, 86, 89.999, 90, 120]) {
      expect(latToRow(lat)).toBe(0)
    }
  })

  it('latitudes at or beyond the south limit clamp to the last row', () => {
    for (const lat of [-MERCATOR_MAX_LAT, -86, -90, -120]) {
      expect(latToRow(lat)).toBe(HEATMAP_GRID_H - 1)
    }
  })

  it('never returns NaN for extreme latitudes', () => {
    for (const lat of [90, -90]) {
      expect(Number.isFinite(mercatorY(lat))).toBe(true)
      expect(Number.isFinite(latToRowFraction(lat))).toBe(true)
    }
  })

  it('lonToCol clamps to [0, gridW - 1]', () => {
    expect(lonToCol(-180)).toBe(0)
    expect(lonToCol(180)).toBe(HEATMAP_GRID_W - 1)
    expect(lonToCol(0)).toBe(HEATMAP_GRID_W / 2)
    expect(lonToCol(-500)).toBe(0)
    expect(lonToCol(500)).toBe(HEATMAP_GRID_W - 1)
  })

  it('latToRow and lonToCol honor custom grid sizes', () => {
    expect(latToRow(0, 8)).toBe(4)
    expect(latToRow(90, 8)).toBe(0)
    expect(latToRow(-90, 8)).toBe(7)
    expect(lonToCol(0, 8)).toBe(4)
  })
})

describe('binningWGSL (criterion 2b)', () => {
  const wgsl = binningWGSL()
  const floats = (wgsl.match(/-?\d+\.\d+/g) ?? []).map(Number)

  it('declares lonToCol and latToRow WGSL functions', () => {
    expect(wgsl).toMatch(/fn\s+lonToCol\s*\(\s*lon\s*:\s*f32\s*\)\s*->\s*u32/)
    expect(wgsl).toMatch(/fn\s+latToRow\s*\(\s*lat\s*:\s*f32\s*\)\s*->\s*u32/)
  })

  it('embeds the JS latitude limit', () => {
    expect(floats).toContain(MERCATOR_MAX_LAT)
  })

  it('embeds the Mercator Y of the limit computed in JS', () => {
    const target = mercatorY(MERCATOR_MAX_LAT)
    expect(floats.some((v) => Math.abs(v - target) < 1e-9)).toBe(true)
  })

  it('embeds the grid sizes as f32 literals with a decimal point', () => {
    expect(wgsl).toContain(`${HEATMAP_GRID_W}.0`)
    expect(wgsl).toContain(`${HEATMAP_GRID_H}.0`)
  })

  it('uses a Mercator log-tan formula, not the old linear one', () => {
    expect(wgsl).toMatch(/log\s*\(\s*tan\s*\(/)
    expect(wgsl).not.toContain('(90.0 - lat) / 180.0')
    expect(wgsl).not.toMatch(/\b90\.0\b/)
  })
})
