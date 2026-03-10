import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../api/geoserver.js', () => ({
  fetchWfsLayer: vi.fn(),
}))

import { fetchWfsLayer } from '../api/geoserver.js'
import { useLayerData } from './useLayerData.js'

const mockGeoJson = { type: 'FeatureCollection', features: [{ id: '1' }] }

describe('useLayerData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns loading true initially', () => {
    fetchWfsLayer.mockResolvedValue(mockGeoJson)
    const { result } = renderHook(() => useLayerData('ws:layer'))
    expect(result.current.loading).toBe(true)
  })

  it('returns data after fetch resolves', async () => {
    fetchWfsLayer.mockResolvedValue(mockGeoJson)
    const { result } = renderHook(() => useLayerData('ws:layer'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(mockGeoJson)
    expect(result.current.error).toBeNull()
  })

  it('returns error if fetch rejects', async () => {
    fetchWfsLayer.mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useLayerData('ws:layer'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeNull()
  })
})