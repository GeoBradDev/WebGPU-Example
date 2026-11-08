import { describe, it, expect } from 'vitest'
import { renderBackendLabel } from './gpuLabels.js'

// A device type that names an Object.prototype member must not resolve to
// that member: AC1 says any other non-empty type shows Unknown, not ok.
describe('renderBackendLabel with prototype member names', () => {
  it.each(['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'valueOf'])(
    'shows Unknown for %s',
    (type) => {
      expect(renderBackendLabel(type)).toEqual({ text: 'Unknown', ok: false })
    }
  )
})
