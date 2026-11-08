import { describe, it, expect } from 'vitest'
import {
  MERCATOR_MAX_LAT,
  latToRow,
  lonToCol,
  binningWGSL,
} from './heatmapProjection.js'

// Executes the generated WGSL binning functions by translating them
// mechanically into JS. The translator only knows the WGSL subset the
// generator emits today; anything else throws, so a future edit to the WGSL
// cannot silently fall out of coverage.

const BUILTINS = {
  floor: Math.floor,
  log: Math.log,
  tan: Math.tan,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  u32: (x) => {
    if (!Number.isFinite(x) || x < 0) throw new Error(`u32() of ${x} is out of range`)
    return Math.trunc(x)
  },
}
const KEYWORDS = new Set(['function', 'const', 'return'])

function translateWGSL(wgsl) {
  const declared = new Set()
  let src = wgsl.replace(
    /\bfn\s+(\w+)\s*\(([^)]*)\)\s*->\s*(\w+)/g,
    (_, name, params, ret) => {
      if (ret !== 'u32') throw new Error(`unsupported return type ${ret}`)
      const names = params.split(',').map((p) => {
        const m = p.trim().match(/^(\w+)\s*:\s*f32$/)
        if (!m) throw new Error(`unsupported parameter "${p.trim()}"`)
        declared.add(m[1])
        return m[1]
      })
      declared.add(name)
      return `function ${name}(${names.join(', ')})`
    }
  )
  src = src.replace(/\blet\s+(\w+)/g, (_, name) => {
    declared.add(name)
    return `const ${name}`
  })

  const bad = src.match(/[^\w\s.(){}+\-*/=,;]/)
  if (bad) throw new Error(`unknown character "${bad[0]}" in WGSL`)
  for (const tok of src.match(/[A-Za-z_]\w*/g) ?? []) {
    if (!KEYWORDS.has(tok) && !declared.has(tok) && !(tok in BUILTINS)) {
      throw new Error(`unknown WGSL token "${tok}"`)
    }
  }
  if (!declared.has('lonToCol') || !declared.has('latToRow')) {
    throw new Error('WGSL is missing lonToCol or latToRow')
  }

  const names = Object.keys(BUILTINS)
  const factory = new Function(...names, `${src}\nreturn { lonToCol, latToRow }`)
  return factory(...names.map((n) => BUILTINS[n]))
}

describe('translateWGSL', () => {
  it('throws on a WGSL token it does not know', () => {
    const wgsl = 'fn latToRow(lat: f32) -> u32 { return u32(select(0.0, 1.0, lat > 0.0)); }'
    expect(() => translateWGSL(wgsl)).toThrow()
  })

  it('throws on an unknown identifier', () => {
    const wgsl = 'fn lonToCol(lon: f32) -> u32 { return u32(abs(lon)); }\nfn latToRow(lat: f32) -> u32 { return u32(lat); }'
    expect(() => translateWGSL(wgsl)).toThrow(/abs/)
  })
})

describe('generated WGSL binning executes like the JS helpers', () => {
  const gpu = translateWGSL(binningWGSL())

  it('latToRow matches at reference latitudes and beyond the limits', () => {
    const lats = [0, 40, 60, 65, -33.9, MERCATOR_MAX_LAT, -MERCATOR_MAX_LAT, 90, -90, 120, -120]
    for (const lat of lats) {
      expect(gpu.latToRow(lat), `lat ${lat}`).toBe(latToRow(lat))
    }
  })

  it('latToRow matches over a sweep of -85 to 85', () => {
    for (let lat = -85; lat <= 85; lat += 0.01) {
      expect(gpu.latToRow(lat)).toBe(latToRow(lat))
    }
  })

  it('lonToCol matches at reference longitudes and beyond the limits', () => {
    for (const lon of [-180, -179.9, -0.0001, 0, 0.0001, 18, 151.18, 179.9, 180, -500, 500]) {
      expect(gpu.lonToCol(lon), `lon ${lon}`).toBe(lonToCol(lon))
    }
  })

  it('lonToCol matches over a sweep of -180 to 180', () => {
    for (let lon = -180; lon <= 180; lon += 0.01) {
      expect(gpu.lonToCol(lon)).toBe(lonToCol(lon))
    }
  })
})
