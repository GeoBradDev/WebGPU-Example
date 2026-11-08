import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Contrast in interactive states (hover, focus, active, :has()). The resting
// state is covered by styles.test.js.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function innermostRules(source) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(source)) !== null) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
  }
  return rules
}

function declarations(body) {
  const decls = {}
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim()
    if (prop) decls[prop] = part.slice(idx + 1).trim()
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

function token(name) {
  const value = rule(':root')[name]
  if (!value) throw new Error(`token not found: ${name}`)
  return parseColor(value)
}

function varName(value) {
  const m = value && value.match(/var\((--[\w-]+)\)/)
  return m ? m[1] : null
}

function composite(fg, bg) {
  const a = fg.a
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

// Hovered layer row: the :hover background over the panel over the worst-case
// white map.
function hoveredRowBackground() {
  const hoverBg = varName(rule('.layer-row:hover').background)
  if (!hoverBg) throw new Error('.layer-row:hover background is not a token')
  return composite(token(hoverBg), composite(token('--bg-panel'), WHITE))
}

// Every rule with a state selector that sets a background, and how it is modeled.
const STATE_BACKGROUNDS = {
  '.layer-row:hover': hoveredRowBackground,
}

// Text inside a .layer-row. The first selector found wins, so a hover-specific
// override (if one is ever added) is measured in place of the base rule.
const HOVERED_ROW_TEXT = [
  { name: 'layer label', selectors: ['.layer-row:hover .layer-label', '.layer-label'] },
  {
    name: 'active layer label',
    selectors: ['.layer-row.active:hover .layer-label', '.layer-row.active .layer-label'],
  },
  { name: 'ON toggle', selectors: ['.layer-row:hover .layer-toggle.on', '.layer-toggle.on'] },
  { name: 'OFF toggle', selectors: ['.layer-row:hover .layer-toggle.off', '.layer-toggle.off'] },
]

function effectiveColorToken(selectors) {
  for (const s of selectors) {
    if (!RULES.some((r) => r.selector === s)) continue
    const color = rule(s).color
    if (color) return { selector: s, token: varName(color) }
  }
  throw new Error(`no color rule for ${selectors.join(' | ')}`)
}

describe('hovered layer row contrast', () => {
  it.each(HOVERED_ROW_TEXT)('$name meets 4.5:1 on the hovered row', ({ name, selectors }) => {
    const bg = hoveredRowBackground()
    const { selector, token: t } = effectiveColorToken(selectors)
    expect(t, `${selector}: color is not a token`).toBeTruthy()
    const ratio = contrast(composite(token(t), bg), bg)
    expect(ratio, `${name} (${selector}, ${t}) on hovered row is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('off-state dot meets 3:1 on the hovered row', () => {
    // Off-state dot color is set inline in LayerPanel.jsx.
    const bg = hoveredRowBackground()
    const ratio = contrast(composite(token('--text-dim'), bg), bg)
    expect(ratio, `--text-dim dot on hovered row is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })
})

describe('state background coverage', () => {
  it('models every state rule that sets a background', () => {
    const STATE = /:hover|:focus|:focus-visible|:active|:has\(/
    const uncovered = RULES.filter((r) => STATE.test(r.selector))
      .filter((r) => {
        const d = declarations(r.body)
        return 'background' in d || 'background-color' in d
      })
      .map((r) => r.selector)
      .filter((s) => !(s in STATE_BACKGROUNDS))
    expect(uncovered).toEqual([])
  })
})
