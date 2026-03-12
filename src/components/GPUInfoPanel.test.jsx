import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

const base = {
  tier: 'webgpu',
  adapterInfo: { device: 'Test GPU' },
  activePointCount: 1000,
  frameTime: 16,
  frameHistory: [],
  gpuThroughput: '--',
}

describe('GPUInfoPanel', () => {
  it('renders GPU device name', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('Test GPU')).toBeInTheDocument()
  })

  it('renders COMPUTE key', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('COMPUTE')).toBeInTheDocument()
  })

  it('renders compute throughput value', () => {
    render(<GPUInfoPanel capabilities={{ ...base, gpuThroughput: '450 GB/s' }} />)
    expect(screen.getByText('450 GB/s')).toBeInTheDocument()
  })

  it('renders -- when compute unsupported', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders sparkline SVG when frameHistory has data', () => {
    const { container } = render(
      <GPUInfoPanel capabilities={{ ...base, frameHistory: [16, 17, 15, 18, 16] }} />
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('omits sparkline SVG when frameHistory is empty', () => {
    const { container } = render(<GPUInfoPanel capabilities={base} />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('frame time is green at or under 16ms', () => {
    const { container } = render(<GPUInfoPanel capabilities={{ ...base, frameTime: 16 }} />)
    expect(container.querySelector('.gpu-info-val.ok')).toBeInTheDocument()
  })

  it('frame time is amber between 17ms and 33ms', () => {
    const { container } = render(<GPUInfoPanel capabilities={{ ...base, frameTime: 33 }} />)
    expect(container.querySelector('.gpu-info-val.warn')).toBeInTheDocument()
  })

  it('frame time is red above 33ms', () => {
    const { container } = render(<GPUInfoPanel capabilities={{ ...base, frameTime: 50 }} />)
    expect(container.querySelector('.gpu-info-val.err')).toBeInTheDocument()
  })
})