import { useState, useEffect } from 'react'
import { fetchWfsLayer } from '../api/geoserver.js'

/**
 * Fetches a WFS layer from GeoServer and returns { data, loading, error }.
 * Re-fetches when typeName or cqlFilter changes.
 * @param {string} typeName - e.g. 'myWorkspace:myLayer'
 * @param {string} [cqlFilter] - optional CQL filter
 */
export function useLayerData(typeName, cqlFilter) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchWfsLayer(typeName, cqlFilter)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [typeName, cqlFilter])

  return { data, loading, error }
}