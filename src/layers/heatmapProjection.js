// Single source of truth for how the GPU heatmap grid maps to the map.
//
// The heatmap image is drawn by a deck.gl BitmapLayer over HEATMAP_BOUNDS with
// the default image coordinate system, which stretches the image linearly in
// Web Mercator Y. The accumulate shader therefore bins latitude in Mercator Y
// too, using WGSL generated from the constants below, so a point's cell is
// drawn where the point is.

export const MERCATOR_MAX_LAT = 85.051129
export const HEATMAP_GRID_W = 1024
export const HEATMAP_GRID_H = 512
export const HEATMAP_BOUNDS = [-180, -MERCATOR_MAX_LAT, 180, MERCATOR_MAX_LAT]

const QUARTER_PI = Math.PI / 4
const HALF_DEG_TO_RAD = Math.PI / 360

/**
 * Web Mercator Y (in radians of the unit sphere) for a latitude in degrees,
 * with latitude clamped to +/-MERCATOR_MAX_LAT so the result is always finite.
 * @param {number} lat
 * @returns {number}
 */
export function mercatorY(lat) {
  const clamped = Math.min(Math.max(lat, -MERCATOR_MAX_LAT), MERCATOR_MAX_LAT)
  return Math.log(Math.tan(QUARTER_PI + clamped * HALF_DEG_TO_RAD))
}

const MERCATOR_MAX_Y = mercatorY(MERCATOR_MAX_LAT)

/**
 * Fraction of the image height from the north edge (0) to the south edge (1).
 * @param {number} lat
 * @returns {number}
 */
export function latToRowFraction(lat) {
  return (1 - mercatorY(lat) / MERCATOR_MAX_Y) / 2
}

/**
 * @param {number} lat
 * @param {number} [gridH]
 * @returns {number} row in [0, gridH - 1], north at row 0
 */
export function latToRow(lat, gridH = HEATMAP_GRID_H) {
  const row = Math.floor(latToRowFraction(lat) * gridH)
  return Math.min(Math.max(row, 0), gridH - 1)
}

/**
 * @param {number} lon
 * @param {number} [gridW]
 * @returns {number} column in [0, gridW - 1]
 */
export function lonToCol(lon, gridW = HEATMAP_GRID_W) {
  const col = Math.floor(((lon + 180) / 360) * gridW)
  return Math.min(Math.max(col, 0), gridW - 1)
}

/** Format a JS number as a WGSL f32 literal (always with a decimal point). */
function f32(value) {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

/**
 * WGSL functions `lonToCol(lon: f32) -> u32` and `latToRow(lat: f32) -> u32`
 * matching the JS helpers above, with every constant interpolated from JS.
 * @returns {string}
 */
export function binningWGSL() {
  return `
fn lonToCol(lon: f32) -> u32 {
  let c = floor((lon + 180.0) / 360.0 * ${f32(HEATMAP_GRID_W)});
  return u32(clamp(c, 0.0, ${f32(HEATMAP_GRID_W - 1)}));
}

fn latToRow(lat: f32) -> u32 {
  let clamped = clamp(lat, ${f32(-MERCATOR_MAX_LAT)}, ${f32(MERCATOR_MAX_LAT)});
  let y = log(tan(${f32(QUARTER_PI)} + clamped * ${f32(HALF_DEG_TO_RAD)}));
  let fraction = (1.0 - y / ${f32(MERCATOR_MAX_Y)}) / 2.0;
  let r = floor(fraction * ${f32(HEATMAP_GRID_H)});
  return u32(clamp(r, 0.0, ${f32(HEATMAP_GRID_H - 1)}));
}
`
}
