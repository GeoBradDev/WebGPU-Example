import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'))

const REMOVED = [
  'axios',
  'deck.gl',
  '@deck.gl/react',
  '@loaders.gl/core',
  '@loaders.gl/json',
  '@luma.gl/webgpu',
]

const PRERELEASE = /\d+\.\d+\.\d+-[A-Za-z]/

function allRanges() {
  return {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  }
}

describe('package.json manifest', () => {
  it('has no overrides block', () => {
    expect(manifest).not.toHaveProperty('overrides')
  })

  it('pins no pre-release version ranges', () => {
    const prereleases = Object.entries(allRanges())
      .filter(([, range]) => PRERELEASE.test(range))
      .map(([name, range]) => `${name}@${range}`)
    expect(prereleases).toEqual([])
  })

  it('does not list unused dependencies', () => {
    const present = REMOVED.filter((name) => name in (manifest.dependencies || {}))
    expect(present).toEqual([])
  })

  it('requires maplibre-gl 6 or later', () => {
    const range = manifest.dependencies['maplibre-gl']
    const major = Number(range.match(/(\d+)\./)[1])
    expect(major).toBeGreaterThanOrEqual(6)
  })
})
