import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'
import userEvent from '@testing-library/user-event'

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

  it('renders WEBGPU COMPUTE key', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.getByText('WEBGPU COMPUTE')).toBeInTheDocument()
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
  it('marks GPU, WEBGPU COMPUTE, and HEATMAP as secondary and keeps RENDER, PTS, FRAME primary', () => {
    render(<GPUInfoPanel capabilities={{ ...base, heatmapComputeMs: 42 }} />)
    const item = (key) => screen.getByText(key).closest('.gpu-info-item')
    for (const key of ['GPU', 'WEBGPU COMPUTE', 'HEATMAP']) {
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

describe('GPUInfoPanel benchmark control', () => {
  const bench = (over = {}) => ({ supported: true, running: false, onRun: vi.fn(), ...over })

  it('has no RUN button when the benchmark prop is omitted', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(screen.queryByRole('button', { name: 'Run compute benchmark' })).not.toBeInTheDocument()
  })

  it('has no RUN button when the benchmark is unsupported', () => {
    render(<GPUInfoPanel capabilities={base} benchmark={bench({ supported: false })} />)
    expect(screen.queryByRole('button', { name: 'Run compute benchmark' })).not.toBeInTheDocument()
    expect(screen.getByText('WEBGPU COMPUTE').closest('.gpu-info-item')).toHaveTextContent('--')
  })

  it('renders a native RUN button inside the WEBGPU COMPUTE item when supported', () => {
    render(<GPUInfoPanel capabilities={base} benchmark={bench()} />)
    const button = screen.getByRole('button', { name: 'Run compute benchmark' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveTextContent('RUN')
    expect(button).toHaveClass('gpu-bench-btn')
    expect(button.closest('.gpu-info-item')).toBe(screen.getByText('WEBGPU COMPUTE').closest('.gpu-info-item'))
  })

  it('runs on click', async () => {
    const b = bench()
    render(<GPUInfoPanel capabilities={base} benchmark={b} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run compute benchmark' }))
    expect(b.onRun).toHaveBeenCalledTimes(1)
  })

  it('is reachable with Tab and runs on Enter and on Space', async () => {
    const user = userEvent.setup()
    const b = bench()
    render(<GPUInfoPanel capabilities={base} benchmark={b} />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Run compute benchmark' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(b.onRun).toHaveBeenCalledTimes(1)
    await user.keyboard(' ')
    expect(b.onRun).toHaveBeenCalledTimes(2)
  })

  it('is aria-disabled, still focusable, and ignores activation while running', async () => {
    const user = userEvent.setup()
    const b = bench({ running: true })
    render(<GPUInfoPanel capabilities={{ ...base, gpuThroughput: 'Running...' }} benchmark={b} />)
    const button = screen.getByRole('button', { name: 'Run compute benchmark' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(button)
    expect(b.onRun).not.toHaveBeenCalled()
  })

  it('has no aria-disabled when idle', () => {
    render(<GPUInfoPanel capabilities={base} benchmark={bench()} />)
    expect(screen.getByRole('button', { name: 'Run compute benchmark' })).not.toHaveAttribute('aria-disabled')
  })

  it('announces the WEBGPU COMPUTE value through a polite live region', () => {
    render(<GPUInfoPanel capabilities={{ ...base, gpuThroughput: '~1.3 GB/s est.' }} benchmark={bench()} />)
    const value = screen.getByText('~1.3 GB/s est.')
    expect(value).toHaveAttribute('aria-live', 'polite')
    expect(value).not.toContainElement(screen.getByRole('button', { name: 'Run compute benchmark' }))
  })
})

// Issue #8: RENDER reports the device deck.gl created, not the WebGPU adapter tier.
describe('GPUInfoPanel RENDER backend', () => {
  const renderVal = () => screen.getByText('RENDER').closest('.gpu-info-item').querySelector('.gpu-info-val')

  it('shows Detecting... with a warn class before deck has initialized its device', () => {
    render(<GPUInfoPanel capabilities={base} />)
    expect(renderVal()).toHaveTextContent('Detecting...')
    expect(renderVal()).toHaveClass('warn')
    expect(renderVal()).not.toHaveClass('ok')
  })

  it.each([
    ['webgl', 'WebGL2'],
    ['webgl2', 'WebGL2'],
    ['webgpu', 'WebGPU'],
  ])('shows the deck device type %s as %s with an ok class', (type, text) => {
    render(<GPUInfoPanel capabilities={{ ...base, renderDevice: { type } }} />)
    expect(renderVal()).toHaveTextContent(text)
    expect(renderVal()).toHaveClass('ok')
  })

  it('shows WebGL2 when the WebGPU tier is available but deck renders with WebGL', () => {
    render(<GPUInfoPanel capabilities={{ ...base, tier: 'webgpu', renderDevice: { type: 'webgl' } }} />)
    expect(renderVal()).toHaveTextContent('WebGL2')
    expect(screen.queryByText('WebGPU')).not.toBeInTheDocument()
  })

  it.each(['no-webgpu', 'unknown'])('never shows WebGL Fallback when the tier is %s', (tier) => {
    render(<GPUInfoPanel capabilities={{ ...base, tier, renderDevice: { type: 'webgl' } }} />)
    expect(renderVal()).toHaveTextContent('WebGL2')
    expect(screen.queryByText('WebGL Fallback')).not.toBeInTheDocument()
  })

  it('shows Unknown with a warn class for an unrecognized device type', () => {
    render(<GPUInfoPanel capabilities={{ ...base, renderDevice: { type: 'null' } }} />)
    expect(renderVal()).toHaveTextContent('Unknown')
    expect(renderVal()).toHaveClass('warn')
  })

  it('falls back to the render device renderer for the GPU label when the adapter offers nothing', () => {
    render(
      <GPUInfoPanel
        capabilities={{ ...base, tier: 'no-webgpu', adapterInfo: {}, renderDevice: { type: 'webgl', renderer: 'ANGLE (Test)' } }}
      />
    )
    expect(screen.getByText('GPU').closest('.gpu-info-item')).toHaveTextContent('ANGLE (Test)')
  })
})
