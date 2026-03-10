export function FeaturePopup({ feature, onClose }) {
  if (!feature) return null

  return (
    <div className="feature-popup">
      <div className="popup-header">
        <span className="popup-title">FEATURE INTEL</span>
        <button className="popup-close" aria-label="close" onClick={onClose}>
          ✕
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