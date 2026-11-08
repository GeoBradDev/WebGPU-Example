import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

// The GPU name can be a ~90 character WebGL renderer string. It is truncated
// by CSS (gpu-info-name) so the panel clears the feature popup, and the full
// name stays readable in the title attribute.
const RENDERER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
const base = {
  tier: 'no-webgpu',
  adapterInfo: {},
  renderDevice: { type: 'webgl', renderer: RENDERER },
  activePointCount: 0,
  frameTime: 16,
  frameHistory: [],
  gpuThroughput: '--',
}

describe('GPUInfoPanel GPU name', () => {
  const gpuVal = () => screen.getByText('GPU').closest('.gpu-info-item').querySelector('.gpu-info-val')

  it('marks the GPU value for truncation and keeps the full name in title', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(gpuVal()).toHaveClass('gpu-info-name')
    expect(gpuVal()).toHaveAttribute('title', RENDERER)
    expect(gpuVal()).toHaveTextContent(RENDERER)
  })

  it('titles a short adapter name too', () => {
    render(<GPUInfoPanel capabilities={{ ...base, tier: 'webgpu', adapterInfo: { device: 'RTX 4090' } }} />)
    expect(gpuVal()).toHaveClass('gpu-info-name')
    expect(gpuVal()).toHaveAttribute('title', 'RTX 4090')
  })
})
