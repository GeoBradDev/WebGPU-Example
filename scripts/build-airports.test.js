// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMainModule } from './build-airports.mjs'

// Issue #9 review F4: run through a symlinked path, Node realpaths the module
// URL but argv[1] keeps the link, so a plain path compare skipped main().
const SCRIPT = fileURLToPath(new URL('./build-airports.mjs', import.meta.url))
const MODULE_URL = pathToFileURL(SCRIPT).href
const dir = mkdtempSync(join(tmpdir(), 'build-airports-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isMainModule', () => {
  it('is true when argv[1] is the script path', () => {
    expect(isMainModule(SCRIPT, MODULE_URL)).toBe(true)
  })

  it('is true when argv[1] is a symlink to the script', () => {
    const link = join(dir, 'link.mjs')
    symlinkSync(SCRIPT, link)
    expect(isMainModule(link, MODULE_URL)).toBe(true)
  })

  it('is true when argv[1] goes through a symlinked directory', () => {
    const linkDir = join(dir, 'linked-scripts')
    symlinkSync(fileURLToPath(new URL('.', import.meta.url)), linkDir)
    expect(isMainModule(join(linkDir, 'build-airports.mjs'), MODULE_URL)).toBe(true)
  })

  it('is false for another script, a missing path, or no argv[1]', () => {
    expect(isMainModule(fileURLToPath(new URL('./airports-transform.js', import.meta.url)), MODULE_URL)).toBe(false)
    expect(isMainModule(join(dir, 'does-not-exist.mjs'), MODULE_URL)).toBe(false)
    expect(isMainModule(undefined, MODULE_URL)).toBe(false)
  })
})
