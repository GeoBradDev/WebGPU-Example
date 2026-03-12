import { useMemo } from 'react'

const EMPTY = {}

export function useStressPoints(count) {
  const stressPoints = useMemo(() => {
    if (!count) return EMPTY
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = Math.random() * 360 - 180  // lon
      positions[i * 3 + 1] = Math.random() * 170 - 85   // lat
      positions[i * 3 + 2] = 0                           // alt
    }
    return {
      length: count,
      attributes: { getPosition: { value: positions, size: 3 } },
    }
  }, [count])

  return { stressPoints }
}