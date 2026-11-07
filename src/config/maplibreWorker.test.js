// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// maplibre-gl 6 resolves its web worker from import.meta.url, which a bundler
// does not follow. Without an explicit setWorkerUrl() pointing at a bundled
// worker, the production build ships no worker and the basemap never loads
// ("Worker failed to load").
describe('production bundle', () => {
  it('emits the maplibre worker and references it from the app code', async () => {
    const result = await build({
      root,
      configFile: resolve(root, 'vite.config.js'),
      logLevel: 'silent',
      build: { write: false },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output)

    const worker = outputs.find((o) => /maplibre-gl-worker[^/]*\.m?js$/.test(o.fileName))
    expect(worker, 'no maplibre-gl-worker file in the build output').toBeDefined()

    const referencing = outputs.filter(
      (o) => o.type === 'chunk' && o !== worker && o.code.includes(worker.fileName.split('/').pop())
    )
    expect(referencing.length).toBeGreaterThan(0)
  }, 120000)
})
