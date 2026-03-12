# Satellite Constellation Layer - Design Spec

Date: 2026-03-11

## Goal

Demonstrate WebGPU's raw rendering scale in the Geospatial/GEOINT domain by adding a satellite constellation layer to the existing WebGPU Groundtruth app. The showcase renders all ~23,000+ tracked orbital objects (active satellites + debris) in real time, with a live metrics HUD showing point count and FPS.

No backend required. All data is fetched from public Celestrak endpoints.

## Context

Existing stack: React + Vite, deck.gl with luma.gl WebGPU backend, MapLibre GL, Zustand. Current layers: AIS vessels, ADS-B tracks. The satellite layer integrates as a new toggleable layer alongside these, using the same LayerPanel and mapStore patterns.

## What Gets Built

### New Files

- `src/workers/satellite.worker.js` - Web Worker that parses TLE text, propagates all satellite positions to current time using satellite.js SGP4, posts a Float32Array of [lon, lat, isActive] per object every 10 seconds
- `src/gpu/classifier.js` - WebGPU compute pipeline: takes the full position buffer as a GPU storage buffer, classifies each point by active/debris flag and current filter mode, writes RGBA color per point and a visible-count atomic. Falls back to a CPU JS loop if navigator.gpu is unavailable.
- `src/hooks/useSatellites.js` - manages worker lifecycle, fetches both Celestrak TLE feeds, feeds propagated data through the classifier, returns { positions, colors, visibleCount, totalCount }
- `src/components/MetricsHUD.jsx` - fixed overlay showing "X / Y objects @ Z fps (WebGPU)", styled to match the existing military-aesthetic header

### Modified Files

- `src/layers/index.js` - add SatelliteLayer ScatterplotLayer entry
- `src/store/mapStore.js` - add satelliteFilter: 'all' | 'active' Zustand slice
- `src/components/LayerPanel.jsx` - add satellites toggle and active/all filter sub-toggle

## Data Flow

1. `useSatellites` fetches on mount:
   - Full catalog: `https://celestrak.org/pub/TLE/catalog.txt` (~23k objects)
   - Active only: `https://celestrak.org/pub/TLE/active.txt` (~8k objects)
   - Both feeds cached in sessionStorage with a 1-hour TTL
2. Raw TLE text is sent to the Web Worker, which parses and propagates all positions, posting a Float32Array back every 10 seconds
3. Main thread passes the buffer to GPUClassifier, which runs a WGSL compute shader: reads isActive flag, applies filter mode, writes RGBA color per point, increments atomic visible-count
4. RGBA output is read back as a typed array and passed as getFillColor binary attribute to the deck.gl ScatterplotLayer
5. MetricsHUD reads visible count and measures frame delta for FPS, updating once per second

## Error Handling

- Celestrak fetch failure: retry once, then disable the layer toggle and show a status message. Use sessionStorage cache if available and under 1 hour old.
- WebGPU unavailable: GPUClassifier detects navigator.gpu on init and falls back to a CPU classification loop. MetricsHUD shows "WebGL fallback" instead of "WebGPU".
- Worker errors: log and skip the update cycle, keep the interval running.

## Key Constraints

- No backend, no authentication
- JavaScript only (no TypeScript)
- Fits existing file structure and naming conventions
- Minimal additions: no new routes, no new pages
- The filter toggle (all objects vs active only) lives in LayerPanel, state in Zustand