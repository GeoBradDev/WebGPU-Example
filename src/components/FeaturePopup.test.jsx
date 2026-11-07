import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturePopup } from './FeaturePopup.jsx'

const feature = {
  properties: { name: 'Test Site', status: 'active' },
}

describe('FeaturePopup', () => {
  it('renders nothing when feature is null', () => {
    const { container } = render(<FeaturePopup feature={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders feature properties', () => {
    render(<FeaturePopup feature={feature} onClose={vi.fn()} />)
    expect(screen.getByText('NAME')).toBeInTheDocument()
    expect(screen.getByText('Test Site')).toBeInTheDocument()
    expect(screen.getByText('STATUS')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<FeaturePopup feature={feature} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('FeaturePopup keyboard and screen reader access', () => {
  it('is a dialog named by its title', () => {
    render(<FeaturePopup feature={feature} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'FEATURE INTEL' })).toBeInTheDocument()
  })

  it('names the close button Close and hides its glyph', () => {
    render(<FeaturePopup feature={feature} onClose={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('moves focus to the dialog when it opens', () => {
    render(<FeaturePopup feature={feature} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'FEATURE INTEL' })).toHaveFocus()
  })

  it('reaches the close button with Tab and activates it with Enter', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FeaturePopup feature={feature} onClose={onClose} />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose once on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FeaturePopup feature={feature} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  function Harness({ feature: f, onClose }) {
    return (
      <>
        <button type="button">Opener</button>
        <FeaturePopup feature={f} onClose={onClose} />
      </>
    )
  }

  it('returns focus to the previously focused element when it closes', () => {
    const { rerender } = render(<Harness feature={null} onClose={vi.fn()} />)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    rerender(<Harness feature={feature} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'FEATURE INTEL' })).toHaveFocus()
    rerender(<Harness feature={null} onClose={vi.fn()} />)
    expect(opener).toHaveFocus()
  })

  it('does not take focus back when rerendered with a new onClose', () => {
    const { rerender } = render(<Harness feature={feature} onClose={vi.fn()} />)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    rerender(<Harness feature={feature} onClose={vi.fn()} />)
    expect(opener).toHaveFocus()
  })

  it('does not take focus back when switching to another feature', () => {
    const other = { properties: { name: 'Other Site' } }
    const { rerender } = render(<Harness feature={feature} onClose={vi.fn()} />)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    rerender(<Harness feature={other} onClose={vi.fn()} />)
    expect(opener).toHaveFocus()
  })

  it('calls the latest onClose on Escape', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness feature={feature} onClose={first} />)
    rerender(<Harness feature={feature} onClose={second} />)
    await user.keyboard('{Escape}')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('does not call onClose on Escape after it has closed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<Harness feature={feature} onClose={onClose} />)
    rerender(<Harness feature={null} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})
