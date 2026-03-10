import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

vi.mock('axios', () => {
  const makeInstance = () => ({
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { baseURL: '' },
  })
  return { default: { create: vi.fn(makeInstance) } }
})

describe('geoserver client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates axios instance with correct baseURL', async () => {
    const { geoserverClient } = await import('./geoserver.js')
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: expect.stringContaining('/geoserver') })
    )
  })

  it('buildWfsUrl returns correct WFS GetFeature URL params', async () => {
    const { buildWfsUrl } = await import('./geoserver.js')
    const url = buildWfsUrl('myWorkspace:myLayer')
    expect(url).toContain('service=WFS')
    expect(url).toContain('request=GetFeature')
    expect(url).toContain('outputFormat=application%2Fjson')
    expect(url).toContain('typeName=myWorkspace%3AmyLayer')
  })
})