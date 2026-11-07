import { useEffect, useId, useRef } from 'react'

export function FeaturePopup({ feature, onClose }) {
  const open = feature != null
  const titleId = useId()
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined

    const returnTarget = document.activeElement
    dialogRef.current?.focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') onCloseRef.current?.()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (returnTarget && returnTarget.isConnected && typeof returnTarget.focus === 'function') {
        returnTarget.focus()
      }
    }
  }, [open])

  if (!feature) return null

  return (
    <div
      ref={dialogRef}
      className="feature-popup"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="popup-header">
        <span id={titleId} className="popup-title">FEATURE INTEL</span>
        <button type="button" className="popup-close" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <table className="popup-table">
        <tbody>
          {Object.entries(feature.properties ?? {}).map(([key, value]) => (
            <tr key={key}>
              <td className="prop-key">{key.toUpperCase()}</td>
              <td className="prop-val">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
