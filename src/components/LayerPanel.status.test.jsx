import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayerPanel } from './LayerPanel.jsx'
import { useMapStore } from '../store/mapStore.js'
import { NARROW_QUERY } from '../hooks/useMediaQuery.js'

// Issue #10: per-layer loading, loaded, and failed states with Retry.
const allOn = { airports: true, ports: true, heatmap: true }

function makeStatus(over = {}) {
  return {
    airports: { status: 'loaded', count: 84512 },
    ports: { status: 'loaded', count: 0 },
    heatmap: { status: 'ready' },
    ...over,
  }
}

function renderPanel({ status = makeStatus(), heatmapSupported = true } = {}) {
  return render(
    <LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported={heatmapSupported} status={status} />
  )
}

const statusOf = (label) => screen.getByRole('checkbox', { name: `${label} layer` }).closest('.layer-row').nextElementSibling

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LayerPanel data layer status', () => {
  it('shows LOADING... while a layer is in flight', () => {
    renderPanel({ status: makeStatus({ airports: { status: 'loading' } }) })
    expect(statusOf('Airports')).toHaveClass('layer-status')
    expect(statusOf('Airports')).toHaveTextContent('LOADING...')
  })

  it('shows the feature count formatted en-US when loaded, including 0', () => {
    renderPanel()
    expect(statusOf('Airports')).toHaveTextContent('84,512 FEATURES')
    expect(statusOf('Sea Ports')).toHaveTextContent('0 FEATURES')
  })

  it('announces status politely with the layer name as a hidden prefix', () => {
    renderPanel()
    const text = statusOf('Airports').querySelector('[aria-live="polite"]')
    expect(text).toBeInTheDocument()
    expect(text).toHaveTextContent('Airports: 84,512 FEATURES')
    expect(text.querySelector('.visually-hidden')).toHaveTextContent('Airports:')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows LOAD FAILED with the message in title and a named RETRY button', async () => {
    const onRetry = vi.fn()
    renderPanel({
      status: makeStatus({
        airports: { status: 'error', error: new Error('network down'), onRetry },
        ports: { status: 'error', error: new Error('404'), onRetry: vi.fn() },
      }),
    })
    const line = statusOf('Airports')
    expect(line).toHaveTextContent('LOAD FAILED')
    expect(line.querySelector('[title="network down"]')).toHaveTextContent('LOAD FAILED')
    const button = screen.getByRole('button', { name: 'Retry Airports' })
    expect(button).toHaveTextContent('RETRY')
    expect(button).toHaveClass('layer-retry')
    expect(screen.getByRole('button', { name: 'Retry Sea Ports' })).toBeInTheDocument()
    await userEvent.setup().click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the layer checkbox before the RETRY button unmounts', async () => {
    const user = userEvent.setup()
    let rerenderPanel
    const onRetry = vi.fn(() => {
      // Focus must already be on the checkbox when the hook clears the error.
      expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveFocus()
      rerenderPanel(makeStatus({ airports: { status: 'loading' } }))
    })
    const { rerender } = renderPanel({
      status: makeStatus({ airports: { status: 'error', error: new Error('x'), onRetry } }),
    })
    rerenderPanel = (status) =>
      rerender(<LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported status={status} />)

    screen.getByRole('button', { name: 'Retry Airports' }).focus()
    await user.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retry Airports' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})

describe('LayerPanel heatmap status', () => {
  it.each([
    ['waiting', 'AWAITING AIRPORTS'],
    ['blocked', 'NO AIRPORT DATA'],
    ['computing', 'COMPUTING...'],
    ['ready', 'READY'],
  ])('shows %s as %s', (status, text) => {
    renderPanel({ status: makeStatus({ heatmap: { status } }) })
    expect(statusOf('Heatmap')).toHaveTextContent(text)
    expect(screen.queryByRole('button', { name: 'Retry Heatmap' })).not.toBeInTheDocument()
  })

  it('shows COMPUTE FAILED with the message in title and a Retry Heatmap button', async () => {
    const onRetry = vi.fn()
    renderPanel({
      status: makeStatus({ heatmap: { status: 'error', error: new Error('Invalid ShaderModule'), onRetry } }),
    })
    expect(statusOf('Heatmap').querySelector('[title="Invalid ShaderModule"]')).toHaveTextContent('COMPUTE FAILED')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry Heatmap' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('hides the heatmap row and shows the WebGPU note when unsupported', () => {
    renderPanel({ status: makeStatus({ heatmap: { status: 'unsupported' } }), heatmapSupported: false })
    expect(screen.queryByText('HEATMAP')).not.toBeInTheDocument()
    expect(screen.getByText('WEBGPU UNAVAILABLE: HEATMAP AND COMPUTE BENCHMARK OFF')).toHaveClass('layer-note')
  })

  it('shows no note when WebGPU is available', () => {
    renderPanel()
    expect(screen.queryByText(/WEBGPU UNAVAILABLE/)).not.toBeInTheDocument()
  })
})

describe('LayerPanel without a status prop', () => {
  it('renders no status lines, no note, and no retry buttons', () => {
    const { container } = render(<LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported={false} />)
    expect(container.querySelector('.layer-status')).toBeNull()
    expect(container.querySelector('.layer-note')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('LayerPanel narrow toggle alert', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query) => ({
        matches: query === NARROW_QUERY,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
  })

  it('names the failure count on the collapsed toggle and shows it visibly', () => {
    const { container } = renderPanel({
      status: makeStatus({
        airports: { status: 'error', error: new Error('x'), onRetry: vi.fn() },
        heatmap: { status: 'error', error: new Error('y'), onRetry: vi.fn() },
      }),
    })
    const toggle = screen.getByRole('button', { name: 'Sensor layers, 2 failed' })
    const alert = container.querySelector('.panel-alert')
    expect(alert).toHaveTextContent('2 FAILED')
    expect(toggle).toContainElement(alert)
    expect(alert.nextElementSibling).toHaveClass('panel-chevron')
  })

  it('keeps the plain name when nothing failed', () => {
    const { container } = renderPanel()
    expect(screen.getByRole('button', { name: 'Sensor layers' })).toBeInTheDocument()
    expect(container.querySelector('.panel-alert')).toBeNull()
  })
})
