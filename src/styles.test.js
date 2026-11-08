import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// ─── CSS parsing ───

function normalizeSelector(sel) {
  return sel.trim().replace(/\s+/g, ' ')
}

// Innermost rules: a selector followed by a body that contains no braces.
function innermostRules(source) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(source)) !== null) {
    rules.push({ selector: normalizeSelector(m[1]), body: m[2] })
  }
  return rules
}

function declarations(body) {
  const decls = {}
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (prop) decls[prop] = value
  }
  return decls
}

const RULES = innermostRules(css)

function rule(selector) {
  const found = RULES.filter((r) => r.selector === selector)
  if (found.length === 0) throw new Error(`rule not found: ${selector}`)
  return found.map((r) => declarations(r.body)).reduce((a, b) => ({ ...a, ...b }), {})
}

function parseColor(value) {
  const v = value.trim()
  const hex = v.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  throw new Error(`unsupported color: ${value}`)
}

const TOKENS = (() => {
  const root = rule(':root')
  const tokens = {}
  for (const [prop, value] of Object.entries(root)) {
    if (!prop.startsWith('--')) continue
    try {
      tokens[prop] = parseColor(value)
    } catch {
      // non-color token (fonts)
    }
  }
  return tokens
})()

function token(name) {
  const c = TOKENS[name]
  if (!c) throw new Error(`token not found: ${name}`)
  return c
}

function varName(value) {
  const m = value.match(/var\((--[\w-]+)\)/)
  return m ? m[1] : null
}

// ─── WCAG math ───

function composite(fg, bg, extraAlpha = 1) {
  const a = fg.a * extraAlpha
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 }

// Background models, as rendered.
const BACKGROUNDS = {
  // .app-header sits above the map, over the page background.
  header: () => composite(token('--bg-panel'), token('--bg-void')),
  // Layer panel, GPU panel, popup rows float over the map canvas: worst case white.
  overMap: () => composite(token('--bg-panel'), WHITE),
  // Opaque sticky popup header.
  popupHeader: () => token('--bg-deep'),
  // Classification badge fill.
  accent: () => token('--accent'),
  // Page background.
  void: () => token('--bg-void'),
}

// Every rule in index.css that declares color:, with the background it renders on.
// fg is the token the text resolves to (for inherit, the inherited token).
const TEXT_PAIRS = [
  { selector: 'html, body, #root', bg: 'void' },
  { selector: '.app-title', bg: 'header' },
  { selector: '.classification-badge', bg: 'accent' },
  { selector: '.header-sep', bg: 'header' },
  { selector: '.header-status', bg: 'header' },
  { selector: '.header-status .ok', bg: 'header' },
  { selector: '.header-status .warn', bg: 'header' },
  { selector: '.coord-display', bg: 'header' },
  { selector: '.time-display', bg: 'header' },
  { selector: '.panel-title', bg: 'overMap' },
  { selector: '.panel-toggle', bg: 'overMap', fg: '--text-primary' },
  { selector: '.panel-chevron', bg: 'overMap' },
  { selector: '.layer-label', bg: 'overMap' },
  { selector: '.layer-row.active .layer-label', bg: 'overMap' },
  { selector: '.layer-toggle.on', bg: 'overMap' },
  { selector: '.layer-toggle.off', bg: 'overMap' },
  { selector: '.footer-stat', bg: 'overMap' },
  { selector: '.stress-count', bg: 'overMap' },
  { selector: '.popup-title', bg: 'popupHeader' },
  { selector: '.popup-close', bg: 'popupHeader' },
  { selector: '.popup-close:hover', bg: 'popupHeader' },
  { selector: '.prop-key', bg: 'overMap' },
  { selector: '.prop-val', bg: 'overMap' },
  { selector: '.gpu-info-key', bg: 'overMap' },
  { selector: '.gpu-info-val', bg: 'overMap' },
  { selector: '.gpu-info-val.ok', bg: 'overMap' },
  { selector: '.gpu-info-val.warn', bg: 'overMap' },
  { selector: '.gpu-info-val.err', bg: 'overMap' },
  { selector: '.gpu-info-sep', bg: 'overMap' },
  { selector: '.gpu-bench-btn', bg: 'overMap' },
  { selector: ".gpu-bench-btn[aria-disabled='true']", bg: 'overMap' },
]

function textRatio({ selector, bg, fg }) {
  const decls = rule(selector)
  const fgName = fg || varName(decls.color)
  if (!fgName) throw new Error(`${selector}: color is not a token (${decls.color})`)
  const opacity = decls.opacity === undefined ? 1 : Number(decls.opacity)
  const background = BACKGROUNDS[bg]()
  const rendered = composite(token(fgName), background, opacity)
  return { ratio: contrast(rendered, background), fgName, opacity }
}

function px(value) {
  const m = value && value.match(/^([\d.]+)px$/)
  return m ? Number(m[1]) : NaN
}

function mediaBlock(prelude) {
  const start = css.indexOf(prelude)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return null
}

// ─── Tests ───

describe('contrast math', () => {
  it('computes black on white as 21:1', () => {
    expect(contrast({ r: 0, g: 0, b: 0, a: 1 }, WHITE)).toBeCloseTo(21, 5)
  })

  it('computes the old #2d5a42 on #020c18 as about 2.48:1 (issue #7)', () => {
    expect(contrast(parseColor('#2d5a42'), parseColor('#020c18'))).toBeCloseTo(2.48, 2)
  })
})

describe('text contrast (WCAG 1.4.3, 4.5:1)', () => {
  it.each(TEXT_PAIRS)('$selector on $bg', (pair) => {
    const { ratio, fgName, opacity } = textRatio(pair)
    expect(
      ratio,
      `${pair.selector}: ${fgName} at opacity ${opacity} on ${pair.bg} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('covers every rule that declares color:', () => {
    const covered = new Set(TEXT_PAIRS.map((p) => p.selector))
    const uncovered = RULES.filter((r) => /(?:^|[;\s])color\s*:/.test(r.body))
      .map((r) => r.selector)
      .filter((s) => !covered.has(s))
    expect(uncovered).toEqual([])
  })
})

describe('non-text contrast (WCAG 1.4.11, 3:1)', () => {
  const overMap = BACKGROUNDS.overMap()

  const cases = [
    {
      name: 'slider track (webkit)',
      tokenName: () => varName(rule('.stress-slider::-webkit-slider-runnable-track').background),
    },
    {
      name: 'slider track (moz)',
      tokenName: () => varName(rule('.stress-slider::-moz-range-track').background),
    },
    {
      name: 'slider thumb (webkit)',
      tokenName: () => varName(rule('.stress-slider::-webkit-slider-thumb').background),
    },
    {
      name: 'slider thumb (moz)',
      tokenName: () => varName(rule('.stress-slider::-moz-range-thumb').background),
    },
    // Off-state dot color is set inline in LayerPanel.jsx.
    { name: 'off-state layer dot', tokenName: () => '--text-dim' },
  ]

  it.each(cases)('$name', ({ name, tokenName }) => {
    const t = tokenName()
    expect(t, `${name}: no token found`).toBeTruthy()
    const ratio = contrast(composite(token(t), overMap), overMap)
    expect(ratio, `${name}: ${t} on overMap is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })
})

describe('target size (WCAG 2.5.8, 24x24)', () => {
  it('popup Close is at least 24x24', () => {
    const d = rule('.popup-close')
    expect(px(d.width)).toBeGreaterThanOrEqual(24)
    expect(px(d.height)).toBeGreaterThanOrEqual(24)
  })

  it('compute benchmark RUN button is at least 24x24', () => {
    const d = rule('.gpu-bench-btn')
    expect(px(d['min-width'])).toBeGreaterThanOrEqual(24)
    expect(px(d['min-height'])).toBeGreaterThanOrEqual(24)
  })

  it('stress slider input is at least 24px tall', () => {
    expect(px(rule('.stress-slider').height)).toBeGreaterThanOrEqual(24)
  })

  it.each(['.stress-slider::-webkit-slider-thumb', '.stress-slider::-moz-range-thumb'])(
    '%s is at least 24x24',
    (selector) => {
      const d = rule(selector)
      expect(px(d.width)).toBeGreaterThanOrEqual(24)
      expect(px(d.height)).toBeGreaterThanOrEqual(24)
    }
  )
})

describe('reduced motion (WCAG 2.3.3)', () => {
  it('disables animations and transitions under prefers-reduced-motion: reduce', () => {
    const block = mediaBlock('@media (prefers-reduced-motion: reduce)')
    expect(block, 'no @media (prefers-reduced-motion: reduce) block').not.toBeNull()
    const universal = innermostRules(block).find((r) => r.selector === '*, *::before, *::after')
    expect(universal, 'no universal rule in the reduced-motion block').toBeTruthy()
    const d = declarations(universal.body)
    expect(d.animation).toBe('none !important')
    expect(d.transition).toBe('none !important')
  })
})
