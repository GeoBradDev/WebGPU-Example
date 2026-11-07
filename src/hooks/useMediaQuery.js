import { useCallback, useSyncExternalStore } from 'react'

export const NARROW_QUERY = '(max-width: 640px), (max-height: 500px)'

function hasMatchMedia() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

function getServerSnapshot() {
  return false
}

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (!hasMatchMedia()) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query]
  )

  const getSnapshot = () => (hasMatchMedia() ? window.matchMedia(query).matches : false)

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
