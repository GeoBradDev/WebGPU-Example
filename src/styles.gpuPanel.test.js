import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// GPU info panel rules that apply above 1024px (outside every @media block).
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function topLevelCss() {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@media', i)
    if (at === -1) return out + css.slice(i)
    out += css.slice(i, at)
    let depth = 0
    let j = css.indexOf('{', at)
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    i = j + 1
  }
  return out
}

function topLevelRule(selector) {
  const decls = {}
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  let found = false
  while ((m = re.exec(topLevelCss())) !== null) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue
    found = true
    for (const part of m[2].split(';')) {
      const idx = part.indexOf(':')
      if (idx !== -1) decls[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
    }
  }
  if (!found) throw new Error(`top-level rule not found: ${selector}`)
  return decls
}

describe('GPU name tooltip', () => {
  it('keeps the panel transparent to the pointer', () => {
    expect(topLevelRule('.gpu-info-panel')['pointer-events']).toBe('none')
  })

  it('lets the truncated GPU name take the pointer so its title shows on hover', () => {
    expect(topLevelRule('.gpu-info-name')['pointer-events']).toBe('auto')
  })
})
