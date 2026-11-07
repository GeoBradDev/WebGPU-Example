import { useState, useEffect } from 'react'

const EMPTY = {}

/**
 * Builds a deck.gl binary columnar point set of `count` random positions.
 * lon in [-180, 180], lat in [-85, 85], alt 0.
 */
export function generateStressPoints(count, random = Math.random) {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = random() * 360 - 180  // lon
    positions[i * 3 + 1] = random() * 170 - 85   // lat
    positions[i * 3 + 2] = 0                     // alt
  }
  return {
    length: count,
    attributes: { getPosition: { value: positions, size: 3 } },
  }
}

/**
 * Generates stress-test points after `count` has been stable for `delayMs`,
 * so dragging the slider does not regenerate on every step and render stays pure.
 */
export function useStressPoints(count, { delayMs = 150 } = {}) {
  const [stressPoints, setStressPoints] = useState(EMPTY)

  useEffect(() => {
    const id = setTimeout(() => {
      setStressPoints(count > 0 ? generateStressPoints(count) : EMPTY)
    }, delayMs)
    return () => clearTimeout(id)
  }, [count, delayMs])

  return { stressPoints }
}
