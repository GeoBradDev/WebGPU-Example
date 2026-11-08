// Pure header status derivation (issue #10).
//
// input: {
//   airports, ports: 'loading' | 'loaded' | 'error'
//   heatmap: 'unsupported' | 'waiting' | 'computing' | 'ready' | 'error'
//   render: 'detecting' | 'ready' | 'failed' | 'lost'
//   basemapFailed: boolean
// }
// returns { level: 'NOMINAL' | 'LOADING' | 'DEGRADED', issues: string[] }
export function deriveSystemStatus({ airports, ports, heatmap, render, basemapFailed }) {
  const issues = []
  if (airports === 'error') issues.push('AIRPORTS FAILED')
  if (ports === 'error') issues.push('PORTS FAILED')
  if (heatmap === 'error') issues.push('HEATMAP FAILED')
  if (heatmap === 'unsupported') issues.push('WEBGPU UNAVAILABLE')
  if (render === 'failed') issues.push('RENDER FAILED')
  if (render === 'lost') issues.push('RENDER LOST')
  if (basemapFailed) issues.push('BASEMAP FAILED')

  if (issues.length > 0) return { level: 'DEGRADED', issues }

  // The heatmap waits on airports, so waiting is loading only while airports
  // are; after an empty airports file it would otherwise never settle.
  const loading =
    airports === 'loading' ||
    ports === 'loading' ||
    (heatmap === 'waiting' && airports === 'loading') ||
    heatmap === 'computing' ||
    render === 'detecting'
  return { level: loading ? 'LOADING' : 'NOMINAL', issues }
}
