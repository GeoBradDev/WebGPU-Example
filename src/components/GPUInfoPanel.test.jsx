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
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(1)
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

  it('shows HEATMAP stat with computeMs when provided', () => {
    render(<GPUInfoPanel capabilities={{ ...base, heatmapComputeMs: 42 }} />)
    expect(screen.getByText('HEATMAP')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()
  })

  it('shows HEATMAP stat as -- when heatmapComputeMs is null', () => {
    render(<GPUInfoPanel capabilities={{ ...base, heatmapComputeMs: null }} />)
    expect(screen.getByText('HEATMAP')).toBeInTheDocument()
  })
})
describe('GPUInfoPanel secondary stats', () => {
  it('marks GPU, COMPUTE, and HEATMAP as secondary and keeps RENDER, PTS, FRAME primary', () => {
    render(<GPUInfoPanel capabilities={{ ...base, heatmapComputeMs: 42 }} />)
    const item = (key) => screen.getByText(key).closest('.gpu-info-item')
    for (const key of ['GPU', 'COMPUTE', 'HEATMAP']) {
      expect(item(key)).toHaveClass('gpu-info-secondary')
    }
    for (const key of ['RENDER', 'PTS', 'FRAME']) {
      expect(item(key)).not.toHaveClass('gpu-info-secondary')
    }
  })

  it('leaves only the separators between RENDER, PTS, and FRAME primary', () => {
    const { container } = render(<GPUInfoPanel capabilities={base} />)
    const visible = Array.from(container.querySelector('.gpu-info-panel').children)
      .filter((el) => !el.classList.contains('gpu-info-secondary'))
      .map((el) => (el.classList.contains('gpu-info-sep') ? '|' : el.querySelector('.gpu-info-key').textContent))
    expect(visible).toEqual(['RENDER', '|', 'PTS', '|', 'FRAME'])
  })
})
