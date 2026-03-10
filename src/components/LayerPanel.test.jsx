import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerPanel } from './LayerPanel.jsx'
import { LAYERS } from '../config/sources.js'

const visibility = { points: true, polygons: false }

describe('LayerPanel', () => {
  it('renders a toggle for each layer', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    Object.values(LAYERS).forEach(({ label }) => {
      expect(screen.getByText(label)).toBeInTheDocument()
    })
  })

  it('reflects current visibility state', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const pointsCheckbox = screen.getByRole('checkbox', { name: LAYERS.POINTS.label })
    const polygonsCheckbox = screen.getByRole('checkbox', { name: LAYERS.POLYGONS.label })
    expect(pointsCheckbox.checked).toBe(true)
    expect(polygonsCheckbox.checked).toBe(false)
  })

  it('calls onToggle with layer id and new value', () => {
    const onToggle = vi.fn()
    render(<LayerPanel visibility={visibility} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('checkbox', { name: LAYERS.POINTS.label }))
    expect(onToggle).toHaveBeenCalledWith('points', false)
  })
})