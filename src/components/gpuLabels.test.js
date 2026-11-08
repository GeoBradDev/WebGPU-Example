import { describe, it, expect } from 'vitest'
import { renderBackendLabel, gpuDeviceLabel } from './gpuLabels.js'

// Issue #8: RENDER must name the backend deck.gl actually created, read from
// the luma.gl device type, never from the WebGPU adapter probe.
describe('renderBackendLabel', () => {
  it('maps the luma.gl WebGL device type to WebGL2', () => {
    expect(renderBackendLabel('webgl')).toEqual({ text: 'WebGL2', ok: true })
  })

  it('accepts webgl2 as an alias for WebGL2', () => {
    expect(renderBackendLabel('webgl2')).toEqual({ text: 'WebGL2', ok: true })
  })

  it('maps the webgpu device type to WebGPU', () => {
    expect(renderBackendLabel('webgpu')).toEqual({ text: 'WebGPU', ok: true })
  })

  it.each([undefined, null, ''])('shows Detecting... before deck has a device (%s)', (type) => {
    expect(renderBackendLabel(type)).toEqual({ text: 'Detecting...', ok: false })
  })

  it('shows Unknown for an unrecognized device type', () => {
    expect(renderBackendLabel('null')).toEqual({ text: 'Unknown', ok: false })
  })
})

describe('gpuDeviceLabel', () => {
  const render = { type: 'webgl', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620)' }

  it('prefers the adapter device', () => {
    expect(gpuDeviceLabel({ device: 'RTX 4090', description: 'desc', vendor: 'nvidia' }, render)).toBe('RTX 4090')
  })

  it('falls back to the adapter description', () => {
    expect(gpuDeviceLabel({ description: 'Apple M2', vendor: 'apple' }, render)).toBe('Apple M2')
  })

  it('joins vendor and architecture when device and description are empty', () => {
    expect(gpuDeviceLabel({ device: '', description: '', vendor: 'intel', architecture: 'gen-12lp' }, render)).toBe(
      'intel gen-12lp'
    )
  })

  it('uses vendor alone when architecture is missing', () => {
    expect(gpuDeviceLabel({ vendor: 'amd' }, render)).toBe('amd')
  })

  it('uses architecture alone when vendor is missing', () => {
    expect(gpuDeviceLabel({ architecture: 'rdna-3' }, render)).toBe('rdna-3')
  })

  it('falls back to the render device renderer string when the adapter offers nothing', () => {
    expect(gpuDeviceLabel({}, render)).toBe('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620)')
  })

  it('shows Unknown when neither the adapter nor the render device names the GPU', () => {
    expect(gpuDeviceLabel({}, { type: 'webgl', renderer: '' })).toBe('Unknown')
    expect(gpuDeviceLabel({}, null)).toBe('Unknown')
    expect(gpuDeviceLabel(undefined, undefined)).toBe('Unknown')
  })
})
