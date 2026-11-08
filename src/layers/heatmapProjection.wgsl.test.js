import { describe, it, expect } from 'vitest'
import {
  MERCATOR_MAX_LAT,
  HEATMAP_GRID_W,
  HEATMAP_GRID_H,
  latToRow,
  lonToCol,
  binningWGSL,
} from './heatmapProjection.js'

// Executes the generated WGSL binning functions by parsing them and emitting
// JS. The parser only knows the WGSL subset the generator emits today
// (fn with f32 params returning u32, let, return, + - * /, unary minus,
// calls to floor/log/tan/clamp/u32); anything else throws, so a future edit
// to the WGSL cannot silently fall out of coverage.
//
// Two modes:
// - f64: plain JS doubles, for exact agreement with the JS helpers.
// - f32: every literal, parameter, operator result and builtin result is
//   rounded with Math.fround, to emulate what the GPU computes.
//
// u32() here throws on a negative or out-of-range input instead of
// saturating, so the shader must clamp explicitly rather than rely on the
// conversion.

const BUILTINS = new Set(['floor', 'log', 'tan', 'clamp', 'u32'])

function tokenize(src) {
  const tokens = []
  const re = /\s*(?:(\d+\.\d+|\d+)|([A-Za-z_]\w*)|(->|[(){},;:=+\-*/]))/y
  let pos = 0
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) {
      const ch = src.slice(pos).trimStart()[0]
      throw new Error(`unknown character "${ch}" in WGSL`)
    }
    pos = re.lastIndex
    if (m[1]) tokens.push({ t: 'num', v: m[1] })
    else if (m[2]) tokens.push({ t: 'id', v: m[2] })
    else tokens.push({ t: 'op', v: m[3] })
  }
  return tokens
}

function compile(wgsl, mode) {
  const f32 = mode === 'f32'
  const F = (code) => (f32 ? `F(${code})` : code)
  const toks = tokenize(wgsl)
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const expect_ = (v) => {
    const tok = next()
    if (!tok || tok.v !== v) throw new Error(`expected "${v}" but found "${tok?.v}"`)
    return tok
  }
  const ident = () => {
    const tok = next()
    if (!tok || tok.t !== 'id') throw new Error(`expected identifier but found "${tok?.v}"`)
    return tok.v
  }

  let scope
  function primary() {
    const tok = next()
    if (!tok) throw new Error('unexpected end of WGSL')
    if (tok.t === 'num') return F(tok.v)
    if (tok.v === '(') {
      const e = expr()
      expect_(')')
      return `(${e})`
    }
    if (tok.t === 'id') {
      if (peek()?.v === '(') {
        if (!BUILTINS.has(tok.v)) throw new Error(`unknown WGSL identifier "${tok.v}"`)
        next()
        const args = []
        if (peek()?.v !== ')') {
          args.push(expr())
          while (peek()?.v === ',') { next(); args.push(expr()) }
        }
        expect_(')')
        const call = `B.${tok.v}(${args.join(', ')})`
        return tok.v === 'u32' ? call : F(call)
      }
      if (!scope.has(tok.v)) throw new Error(`unknown WGSL identifier "${tok.v}"`)
      return tok.v
    }
    throw new Error(`unexpected token "${tok.v}"`)
  }
  function unary() {
    if (peek()?.v === '-') { next(); return F(`-${unary()}`) }
    return primary()
  }
  function binary(sub, ops) {
    let left = sub()
    while (ops.includes(peek()?.v)) {
      const op = next().v
      left = F(`(${left} ${op} ${sub()})`)
    }
    return left
  }
  const term = () => binary(unary, ['*', '/'])
  const expr = () => binary(term, ['+', '-'])

  const fns = {}
  let out = ''
  while (i < toks.length) {
    const kw = ident()
    if (kw !== 'fn') throw new Error(`unknown WGSL identifier "${kw}"`)
    const name = ident()
    scope = new Set()
    expect_('(')
    const params = []
    while (peek()?.v !== ')') {
      const p = ident()
      expect_(':')
      const ty = ident()
      if (ty !== 'f32') throw new Error(`unsupported parameter type ${ty}`)
      params.push(p)
      scope.add(p)
      if (peek()?.v === ',') next()
    }
    expect_(')')
    expect_('->')
    const ret = ident()
    if (ret !== 'u32') throw new Error(`unsupported return type ${ret}`)
    expect_('{')
    let body = params.map((p) => `${p} = ${F(p)};`).join(' ')
    while (peek()?.v !== '}') {
      const kw2 = ident()
      if (kw2 === 'let') {
        const v = ident()
        expect_('=')
        body += ` const ${v} = ${expr()};`
        expect_(';')
        scope.add(v)
      } else if (kw2 === 'return') {
        body += ` return ${expr()};`
        expect_(';')
      } else {
        throw new Error(`unknown WGSL identifier "${kw2}"`)
      }
    }
    expect_('}')
    out += `function ${name}(${params.join(', ')}) {${body} }\n`
    fns[name] = true
  }
  for (const want of ['lonToCol', 'latToRow']) {
    if (!fns[want]) throw new Error(`WGSL is missing ${want}`)
  }

  const fr = f32 ? Math.fround : (x) => x
  const B = {
    floor: Math.floor,
    log: Math.log,
    tan: Math.tan,
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    u32: (x) => {
      if (!Number.isFinite(x) || x < 0 || x > 0xffffffff) throw new Error(`u32() of ${x} is out of range`)
      return Math.trunc(x)
    },
  }
  return new Function('F', 'B', `${out}return { lonToCol, latToRow }`)(fr, B)
}

describe('WGSL translator rejects what it does not know', () => {
  const lon = 'fn lonToCol(lon: f32) -> u32 { return u32(lon); }\n'
  const lat = 'fn latToRow(lat: f32) -> u32 { return u32(lat); }\n'

  it('rejects an unknown builtin call', () => {
    const wgsl = lon + 'fn latToRow(lat: f32) -> u32 { return u32(select(0.0, 1.0, lat)); }'
    expect(() => compile(wgsl, 'f64')).toThrow('unknown WGSL identifier "select"')
  })

  it('rejects an undeclared variable', () => {
    const wgsl = lon + 'fn latToRow(lat: f32) -> u32 { return u32(lat + offset); }'
    expect(() => compile(wgsl, 'f64')).toThrow('unknown WGSL identifier "offset"')
  })

  it('rejects an unknown character', () => {
    const wgsl = lon + 'fn latToRow(lat: f32) -> u32 { return u32(lat % 2.0); }'
    expect(() => compile(wgsl, 'f64')).toThrow('unknown character "%" in WGSL')
  })

  it('rejects an unsupported statement keyword', () => {
    const wgsl = lon + 'fn latToRow(lat: f32) -> u32 { var x = lat; return u32(x); }'
    expect(() => compile(wgsl, 'f64')).toThrow('unknown WGSL identifier "var"')
  })

  it('rejects an unsupported parameter type', () => {
    const wgsl = lon + 'fn latToRow(lat: i32) -> u32 { return u32(lat); }'
    expect(() => compile(wgsl, 'f64')).toThrow('unsupported parameter type i32')
  })

  it('rejects an unsupported return type', () => {
    const wgsl = lon + 'fn latToRow(lat: f32) -> f32 { return lat; }'
    expect(() => compile(wgsl, 'f64')).toThrow('unsupported return type f32')
  })

  it('rejects WGSL missing one of the two functions', () => {
    expect(() => compile(lon, 'f64')).toThrow('WGSL is missing latToRow')
    expect(() => compile(lat, 'f64')).toThrow('WGSL is missing lonToCol')
  })

  it('accepts the minimal valid pair', () => {
    expect(compile(lon + lat, 'f64').latToRow(3.7)).toBe(3)
  })
})

describe('generated WGSL binning in float64 matches the JS helpers exactly', () => {
  const gpu = compile(binningWGSL(), 'f64')

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

describe('generated WGSL binning under f32 emulation stays in the grid (criterion 2c)', () => {
  const gpu = compile(binningWGSL(), 'f32')

  it('north extremes land exactly on row 0', () => {
    for (const lat of [MERCATOR_MAX_LAT, 90, 120]) {
      expect(gpu.latToRow(lat), `lat ${lat}`).toBe(0)
    }
  })

  it('south extremes land exactly on the last row', () => {
    for (const lat of [-MERCATOR_MAX_LAT, -90, -120]) {
      expect(gpu.latToRow(lat), `lat ${lat}`).toBe(HEATMAP_GRID_H - 1)
    }
  })

  it('longitude extremes land exactly on the first and last column', () => {
    for (const lon of [-180, -500]) expect(gpu.lonToCol(lon), `lon ${lon}`).toBe(0)
    for (const lon of [180, 500]) expect(gpu.lonToCol(lon), `lon ${lon}`).toBe(HEATMAP_GRID_W - 1)
  })

  it('latToRow is in range and within one row of the JS helper over -90 to 90', () => {
    for (let lat = -90; lat <= 90; lat += 0.01) {
      const r = gpu.latToRow(lat)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(HEATMAP_GRID_H - 1)
      expect(Math.abs(r - latToRow(lat))).toBeLessThanOrEqual(1)
    }
  })

  it('lonToCol is in range and within one column of the JS helper over -180 to 180', () => {
    for (let lon = -180; lon <= 180; lon += 0.01) {
      const c = gpu.lonToCol(lon)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(HEATMAP_GRID_W - 1)
      expect(Math.abs(c - lonToCol(lon))).toBeLessThanOrEqual(1)
    }
  })
})
