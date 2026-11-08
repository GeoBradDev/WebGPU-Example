import { describe, it, expect } from 'vitest'
import { deriveSystemStatus } from './systemStatus.js'

// Issue #10: the header status is derived from real state, never hard-coded.
const HEALTHY = { airports: 'loaded', ports: 'loaded', heatmap: 'ready', render: 'ready', basemapFailed: false }
const derive = (over) => deriveSystemStatus({ ...HEALTHY, ...over })

describe('deriveSystemStatus', () => {
  it('is NOMINAL with no issues when everything is ready', () => {
    expect(derive()).toEqual({ level: 'NOMINAL', issues: [] })
  })

  it.each([
    [{ airports: 'loading' }],
    [{ ports: 'loading' }],
    [{ airports: 'loading', heatmap: 'waiting' }],
    [{ heatmap: 'computing' }],
    [{ render: 'detecting' }],
  ])('is LOADING while %o', (over) => {
    expect(derive(over)).toEqual({ level: 'LOADING', issues: [] })
  })

  it.each([
    [{ airports: 'error' }, 'AIRPORTS FAILED'],
    [{ ports: 'error' }, 'PORTS FAILED'],
    [{ heatmap: 'error' }, 'HEATMAP FAILED'],
    [{ heatmap: 'unsupported' }, 'WEBGPU UNAVAILABLE'],
    [{ render: 'failed' }, 'RENDER FAILED'],
    [{ render: 'lost' }, 'RENDER LOST'],
    [{ basemapFailed: true }, 'BASEMAP FAILED'],
  ])('is DEGRADED for %o', (over, issue) => {
    expect(derive(over)).toEqual({ level: 'DEGRADED', issues: [issue] })
  })

  it('lists every issue in the fixed order', () => {
    expect(
      deriveSystemStatus({ airports: 'error', ports: 'error', heatmap: 'unsupported', render: 'lost', basemapFailed: true })
    ).toEqual({
      level: 'DEGRADED',
      issues: ['AIRPORTS FAILED', 'PORTS FAILED', 'WEBGPU UNAVAILABLE', 'RENDER LOST', 'BASEMAP FAILED'],
    })
    expect(derive({ heatmap: 'error', render: 'failed' }).issues).toEqual(['HEATMAP FAILED', 'RENDER FAILED'])
  })

  it('prefers DEGRADED over LOADING', () => {
    expect(derive({ airports: 'error', ports: 'loading' })).toEqual({ level: 'DEGRADED', issues: ['AIRPORTS FAILED'] })
  })

  it('is NOMINAL when the heatmap waits on an empty airports file that loaded', () => {
    expect(derive({ heatmap: 'waiting' })).toEqual({ level: 'NOMINAL', issues: [] })
  })

  it('does not count a heatmap waiting on failed airports as loading or as an extra issue', () => {
    expect(derive({ airports: 'error', heatmap: 'waiting' })).toEqual({ level: 'DEGRADED', issues: ['AIRPORTS FAILED'] })
  })
})
