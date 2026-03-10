import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerPanel } from './LayerPanel.jsx'
import { LAYERS } from '../config/sources.js'

const visibility = { points: true }

describe('LayerPanel', () => {
  it('renders a toggle for each layer', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    Object.values(LAYERS).forEach(({ label }) => {
      expect(screen.getByText(label.toUpperCase())).toBeInTheDocument()
    })
  })

  it('reflects current visibility state', () => {
    render(<LayerPanel visibility={visibility} onToggle={vi.fn()} />)
    const aisCheckbox = screen.getAllByRole('checkbox')[0]
    expect(aisCheckbox.checked).toBe(true)
  })

  it('calls onToggle with layer id and new value', () => {
    const onToggle = vi.fn()
    render(<LayerPanel visibility={visibility} onToggle={onToggle} />)
    const aisCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(aisCheckbox)
    expect(onToggle).toHaveBeenCalledWith('points', false)
  })
})