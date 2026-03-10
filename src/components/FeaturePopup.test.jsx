import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('Test Site')).toBeInTheDocument()
    expect(screen.getByText('status')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<FeaturePopup feature={feature} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})