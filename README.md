# WebGPU Groundtruth

A browser map that renders global airports and sea ports over a dark vector basemap and uses WebGPU compute shaders for an airport density heatmap and an on-demand GPU throughput benchmark. A stress-test slider adds up to 5,000,000 random points so you can watch frame time under load.

Built with React 19, Vite, MapLibre GL (through `react-map-gl`), deck.gl (`@deck.gl/mapbox` overlay with `ScatterplotLayer` and `BitmapLayer`), and zustand for UI state.

## What it does

- **Basemap:** CARTO dark-matter vector style rendered by MapLibre GL.
- **Airports layer:** every non-closed airport from the OurAirports CSV, drawn as amber points. Click a point to see its properties.
- **Sea ports layer:** the bundled ports GeoJSON, drawn as green points. Click a point to see its properties.
- **Heatmap layer (WebGPU only):** a two-pass compute shader bins airport positions into a 1024 x 512 grid and colorizes it into a bitmap overlay. It runs once, after the airports load. The layer toggle appears only after that compute succeeds, so it is hidden while airports load, when WebGPU is unavailable, and when the airports fetch or the compute fails.
- **Stress test:** a slider from 0 to 5,000,000 points in steps of 100,000. Points are generated on the main thread 150 ms after the slider stops moving, then drawn as a deck.gl binary attribute layer.
- **GPU info panel:** GPU name (the WebGPU adapter, or the WebGL renderer string when the adapter offers none; a long name is cut off with an ellipsis and shown in full on hover), RENDER: the backend deck.gl actually draws with (`WebGL2`, `WebGPU`, or `Detecting...` until deck has created its device), active point count, frame time with a 60-frame sparkline, an on-demand WebGPU compute benchmark (press `RUN` next to WEBGPU COMPUTE: 5 sequential dispatches over a 64 MB storage buffer, reported as the median in GB/s, labelled `est.` because it is CPU timed, or `Too fast` when the timer is too coarse to measure it; out-of-memory, validation errors, and device loss show `Failed`; the buffer and device are freed when the run ends, and the run stops if the tab is hidden), and heatmap compute time. At 1024px wide or less it shows only RENDER, active point count, and frame time. On small screens (see below) it is hidden while a feature popup is open.
- **Small screens** (640px wide or less, or up to 1024px wide and 500px tall or less): the layer panel starts collapsed behind a "Sensor layers" button, the header drops the coordinates and status, and the feature popup opens as a bottom sheet.

## Requirements

- **Node.js:** current LTS (CI uses `lts/*`). Vite 8 needs Node 20.19+ or 22.12+.
- **Browser:** any browser with WebGL 2 for the map and point layers. deck.gl draws through WebGL; WebGPU is used only for compute.
- **WebGPU (optional):** needed for the heatmap and the WEBGPU COMPUTE readout. Use a browser and GPU where `navigator.gpu.requestAdapter()` returns an adapter, for example current Chrome or Edge on desktop. Without it the app still runs: RENDER still shows `WebGL2` (deck.gl renders with WebGL either way), the heatmap toggle never appears, and on screens wider than 1024px WEBGPU COMPUTE shows `--`.
- **Network access:** the basemap style and tiles come from CARTO and the airports CSV comes from GitHub at runtime. The ports data is bundled.

## Setup from a clean clone

```sh
git clone https://github.com/GeoBradDev/WebGPU-Example.git
cd WebGPU-Example
npm ci
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). No API keys or environment variables are needed.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload. |
| `npm run build` | Production build into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally (default port 4173). |
| `npm run lint` | ESLint over the repo (`eslint.config.js`, includes `react-hooks` rules). |
| `npm test` | Run the Vitest suite once (jsdom). Includes a real `vite build` that checks the MapLibre worker is bundled. |
| `npm run test:watch` | Vitest in watch mode. |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=high` on pushes to `main` and on pull requests.

## Data sources and licenses

| Data | Where it comes from | License |
| --- | --- | --- |
| Airports | [OurAirports](https://ourairports.com/data/) `airports.csv`, fetched at runtime from `https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv` (see `src/config/sources.js`). | Public domain. |
| Sea ports | `public/data/ports.geojson`, bundled with the app and served at `/data/ports.geojson`. The file is the Natural Earth `ne_10m_ports` dataset (1,081 points). | [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) data is public domain. |
| Basemap | [CARTO](https://carto.com/basemaps) dark-matter GL style, `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`, built from OpenStreetMap data. | Map data &copy; [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Map style and tiles &copy; [CARTO](https://carto.com/attributions); use is subject to CARTO's basemap terms, which may require a license for commercial or high-volume use. The MapLibre attribution control shows the required credits; keep it visible. |

Note: the comment in `src/config/sources.js` and the parser in `src/hooks/usePorts.js` refer to the NGA World Port Index (`PORT_NAME`), but the bundled file is Natural Earth and uses `name`. The parser falls back to `name`, so labels still work.

## Project layout

```
src/
  App.jsx                 header, layout, wires hooks to the map
  components/             MapView (MapLibre + deck.gl), LayerPanel, GPUInfoPanel, FeaturePopup
  config/                 data URLs, layer ids, basemap style, MapLibre worker setup
  hooks/                  data loading (useAirports, usePorts), WebGPU (useGPUCapabilities,
                          useGPUCompute, useGPUHeatmap), useStressPoints, useMediaQuery
  layers/index.js         buildLayers(): visibility and data to deck.gl layers
  store/mapStore.js       zustand store: viewport, layer visibility, stress count, selection
public/data/ports.geojson bundled ports data
```

## Known limitations

- The airports layer depends on GitHub raw being reachable. Fetch errors are kept in hook state but not shown in the UI, so the layer just stays empty.
- The basemap needs CARTO to be reachable; offline, only the overlays draw.
- The heatmap runs once per page load from the first non-empty airports list and does not update afterwards.
- Stress points are generated on the main thread. Large counts (millions of points) briefly block the UI once the slider settles.
- The WEBGPU COMPUTE benchmark is CPU timed (submit to `onSubmittedWorkDone`), so it includes driver and callback latency and reads lower than the real memory bandwidth. The `RUN` control is hidden at 1024px wide or less along with the rest of WEBGPU COMPUTE.
- RENDER is set when deck.gl reports the device it created and is not updated afterwards. If deck fails to create a device, RENDER stays `Detecting...`, and a lost WebGL context is not reflected.
- Unit tests run in jsdom, which has no WebGL or WebGPU. GPU code paths are covered by mocks and pure helpers only; check rendering in a real browser.
