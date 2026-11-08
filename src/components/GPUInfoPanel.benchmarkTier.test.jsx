import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GPUInfoPanel } from './GPUInfoPanel.jsx'

// Browsers can expose navigator.gpu while requestAdapter() returns null
// (headless Chromium does). useGPUCapabilities reports that as 'no-webgpu',
// and the RUN control must stay hidden then (issue #11, AC10).
const base = {
  adapterInfo: {},
  activePointCount: 0,
  frameTime: 16,
  frameHistory: [],
  gpuThroughput: '--',
}
const benchmark = { supported: true, running: false, onRun: vi.fn() }

describe('GPUInfoPanel RUN control and the detected tier', () => {
  it.each(['no-webgpu', 'unknown'])('hides the RUN button when the tier is %s', (tier) => {
    render(<GPUInfoPanel capabilities={{ ...base, tier }} benchmark={benchmark} />)
    expect(screen.queryByRole('button', { name: 'Run compute benchmark' })).not.toBeInTheDocument()
    expect(screen.getByText('COMPUTE').closest('.gpu-info-item')).toHaveTextContent('--')
  })

  it('shows the RUN button when the tier is webgpu', () => {
    render(<GPUInfoPanel capabilities={{ ...base, tier: 'webgpu' }} benchmark={benchmark} />)
    expect(screen.getByRole('button', { name: 'Run compute benchmark' })).toBeInTheDocument()
  })
})
