import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayerPanel } from './LayerPanel.jsx'
import { LAYERS } from '../config/sources.js'
import { useMapStore } from '../store/mapStore.js'

const visibility = { airports: true, ports: true }

beforeEach(() => {
  useMapStore.setState(useMapStore.getInitialState())
})

describe('LayerPanel', () => {
  it('renders a toggle for each layer', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: true, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={true}
      />
    )
    Object.values(LAYERS).forEach(({ label }) => {
      expect(screen.getByText(label.toUpperCase())).toBeInTheDocument()
    })
  })

  it('reflects current visibility state', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const firstCheckbox = screen.getAllByRole('checkbox')[0]
    expect(firstCheckbox.checked).toBe(true)
  })

  it('calls onToggle with layer id and new value', () => {
    const onToggle = vi.fn()
    render(<LayerPanel visibility={visibility} onToggle={onToggle} />)
    const firstCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(firstCheckbox)
    expect(onToggle).toHaveBeenCalledWith('airports', false)
  })

  it('shows heatmap toggle when heatmapSupported is true', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: true, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={true}
      />
    )
    expect(screen.getByText('HEATMAP')).toBeInTheDocument()
  })

  it('hides heatmap toggle when heatmapSupported is false', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: true, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={false}
      />
    )
    expect(screen.queryByText('HEATMAP')).not.toBeInTheDocument()
  })

  it('shows 3/3 active count when heatmap is supported and all on', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: true, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={true}
      />
    )
    expect(screen.getByText(/3\/3/)).toBeInTheDocument()
  })

  it('shows 2/2 active count when heatmap is not supported', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: true, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={false}
      />
    )
    expect(screen.getByText(/2\/2/)).toBeInTheDocument()
  })
})

describe('LayerPanel stress slider', () => {
  it('renders STRESS TEST label', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('STRESS TEST')).toBeInTheDocument()
  })

  it('renders a range slider with correct attributes', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '5000000')
    expect(slider).toHaveAttribute('step', '100000')
  })

  it('displays 0 PTS when stressCount is 0', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('0 PTS')).toBeInTheDocument()
  })

  it('displays formatted count when stressCount is 500000', () => {
    useMapStore.setState({ stressCount: 500000 })
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    expect(screen.getByText('500K PTS')).toBeInTheDocument()
  })

  it('calls setStressCount when slider changes', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '500000' } })
    expect(useMapStore.getState().stressCount).toBe(500000)
  })
})

describe('LayerPanel keyboard and screen reader access', () => {
  const allOn = { airports: true, ports: true, heatmap: true }

  it('names each layer toggle as a checkbox with its checked state', () => {
    render(
      <LayerPanel
        visibility={{ airports: true, ports: false, heatmap: true }}
        onToggle={vi.fn()}
        heatmapSupported={true}
      />
    )
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Sea Ports layer' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Heatmap layer' })).toBeChecked()
  })

  it('hides the decorative dot and ON/OFF text from assistive technology', () => {
    render(<LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported={true} />)
    const row = screen.getByRole('checkbox', { name: 'Airports layer' }).closest('label')
    expect(row.querySelector('.layer-dot')).toHaveAttribute('aria-hidden', 'true')
    expect(row.querySelector('.layer-toggle')).toHaveAttribute('aria-hidden', 'true')
  })

  it('visually hides the checkbox instead of removing it', () => {
    render(<LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported={true} />)
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveClass('visually-hidden')
  })

  it('names the stress slider and describes its value in points', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Stress test point count' })
    expect(slider).toHaveAttribute('aria-valuetext', '0 points')
  })

  it('formats the slider value text with thousands separators', () => {
    useMapStore.setState({ stressCount: 500000 })
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Stress test point count' })
    expect(slider).toHaveAttribute('aria-valuetext', '500,000 points')
  })

  it('reaches each layer toggle and then the slider with Tab', async () => {
    const user = userEvent.setup()
    render(<LayerPanel visibility={allOn} onToggle={vi.fn()} heatmapSupported={true} />)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Sea Ports layer' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Heatmap layer' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('slider', { name: 'Stress test point count' })).toHaveFocus()
  })

  it('toggles a focused layer with Space', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<LayerPanel visibility={allOn} onToggle={onToggle} heatmapSupported={true} />)
    await user.tab()
    expect(screen.getByRole('checkbox', { name: 'Airports layer' })).toHaveFocus()
    await user.keyboard(' ')
    expect(onToggle).toHaveBeenCalledWith('airports', false)
  })

  // user-event 14 does not implement arrow keys on range inputs, so the
  // one-step change a browser makes on ArrowRight is dispatched directly.
  // Real arrow key handling is verified in the live browser drive.
  it('updates the slider value text after a one-step change', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Stress test point count' })
    fireEvent.change(slider, { target: { value: '100000' } })
    expect(useMapStore.getState().stressCount).toBe(100000)
    expect(slider).toHaveAttribute('aria-valuetext', '100,000 points')
  })
})
