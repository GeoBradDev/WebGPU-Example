# Plan: GPU heatmap is misregistered: equirectangular grid drawn as a Mercator-stretched bitmap (issue #15)

Risk tier: High. Starts Low, raised once because the visible effect (heat lining up with airports on the rendered map) is a GPU and map-rendering result no unit test in jsdom can exercise, and once because it alters existing behavior (the shader's binning). Small diff, but rounded up per the rules.

Domain skills:
- superpowers:test-driven-development: invoke (every change starts with a failing test).
- context7 / deck.gl docs: used in analysis (see Approach); no further invocation needed.
- vercel-react-best-practices: not applicable because no React component or hook structure changes; only a shader string and layer props change.
- dataviz: not applicable because the color ramp and opacity do not change; only where pixels land.
- frontend-design, a11y skills: not applicable because no UI, markup, or styles change.

## Approach

Bin in Web Mercator inside the shader and keep the BitmapLayer's current Mercator bounds `[-180, -85.051129, 180, 85.051129]` with the default image coordinate system.

Rejected: `_imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT` with bounds `[-180, -90, 180, 90]`. In deck.gl 9.4.1 (`node_modules/@deck.gl/layers/dist/bitmap-layer/bitmap-layer.js` line 177 onward, `bitmap-layer-fragment.js` line 52) it is an underscore (experimental) prop, it reprojects per fragment while clamping latitude to +/-89.9, and the quad corners at +/-90 project to infinite Mercator Y. Whether that renders correctly in the non-interleaved MapboxOverlay is uncertain, and nothing in the repo can pin it in a unit test. Mercator binning is exact, deterministic, and testable in plain JS.

## Acceptance criteria

1. Heatmap hot spots line up with the airport points at all latitudes up to +/-80 (verify visually at about 0, 40, and 65 degrees N).
2. The latitude mapping the shader uses and the bounds and projection of the BitmapLayer agree, and a unit test covers that.

Checkable form:
- 1a. For any latitude in [-80, 80], the cell row the binning maps it to, when drawn by a BitmapLayer stretched linearly in Mercator Y over the layer's bounds, covers a latitude band that contains the input latitude (unit test over a sweep, plus named reference points 0, 40, 60, 65, -33.9).
- 1b. In a real browser with a WebGPU adapter (Chromium, `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`), screenshots with HEATMAP and AIRPORTS on at about 0N (West Africa), 40N (US mid-Atlantic), and 65N (Scandinavia or Alaska) show hot spots on the airport dots, not shifted north.
- 2a. One JS module owns the Mercator latitude limit, the grid dimensions used for rows, the lat-to-row formula, and the BitmapLayer bounds. `buildLayers` uses its bounds and sets no `_imageCoordinateSystem`. The accumulate shader's WGSL binning code is generated from that module's constants (no second hand-typed copy of 85.051129 or of the row formula).
- 2b. A unit test asserts the BitmapLayer's bounds equal the helper's bounds, that the numeric constants embedded in the generated WGSL equal the JS constants, and that the old linear `(90.0 - lat) / 180.0` mapping is gone.
- 2c. Latitudes beyond +/-85.051129 (and +/-90) clamp to the first or last row instead of producing NaN or an out-of-range row.

## Files that change

- `src/layers/heatmapProjection.js` (new): exports `MERCATOR_MAX_LAT = 85.051129`, `HEATMAP_GRID_W = 1024`, `HEATMAP_GRID_H = 512`, `HEATMAP_BOUNDS` (`[-180, -MERCATOR_MAX_LAT, 180, MERCATOR_MAX_LAT]`), `mercatorY(lat)` (`ln(tan(pi/4 + lat*pi/360))` with lat clamped to +/-MERCATOR_MAX_LAT), `latToRowFraction(lat)` (`(1 - mercatorY(lat) / mercatorY(MERCATOR_MAX_LAT)) / 2`, 0 at the north edge, 1 at the south edge), `latToRow(lat, gridH = HEATMAP_GRID_H)` (floor of fraction times gridH, clamped to [0, gridH-1]), `lonToCol(lon, gridW = HEATMAP_GRID_W)` (same as the current shader), and `binningWGSL()` (or a constant string) returning WGSL functions `lonToCol(lon: f32) -> u32` and `latToRow(lat: f32) -> u32` that use the same formula, with the limit, its Mercator Y, and the grid sizes interpolated from the JS values as f32 literals (always with a decimal point).
- `src/layers/heatmapProjection.test.js` (new): reference points and the agreement sweep (1a), clamping (2c), WGSL constants (2b).
- `src/hooks/useGPUHeatmap.js`: import the grid sizes and WGSL from the helper, drop the local `GRID_W`/`GRID_H` constants, call the generated `lonToCol`/`latToRow` in `ACCUMULATE_SHADER`, and export `ACCUMULATE_SHADER` so a test can inspect it. Nothing else in the hook changes.
- `src/hooks/useGPUHeatmap.test.js`: add a test that `ACCUMULATE_SHADER` contains the generated binning code and no `(90.0 - lat) / 180.0`.
- `src/layers/index.js`: `bounds: HEATMAP_BOUNDS`.
- `src/layers/index.test.js`: assert heatmap layer bounds equal `HEATMAP_BOUNDS` and `_imageCoordinateSystem` is undefined.
- `README.md`: only if a line becomes false (Phase 8 decides).

## Order of work

1. Red: write `heatmapProjection.test.js` and the new assertions in `index.test.js` and `useGPUHeatmap.test.js`. Run `npm test`; record the failures.
2. Green: add `heatmapProjection.js`, wire it into `index.js` and `useGPUHeatmap.js`.
3. Full gate (`npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm audit --omit=dev --audit-level=high`).
4. Live drive (below), on `npm run dev` or `npm run preview`.

## Risks

- f32 precision in WGSL: `log(tan(...))` near 85 degrees is fine in f32; the clamp to +/-MERCATOR_MAX_LAT keeps `tan` finite. Rows are floored after clamping the fraction to [0, 1) times gridH, then clamped to gridH-1.
- Floating literal formatting: a JS integer like 1024 interpolated as `1024` is an abstract int in WGSL; emit `1024.0` style f32 literals where floats are expected to avoid type errors. The live drive proves the shader compiles.
- Cell shape: a 1024x512 grid over the square Mercator world gives cells twice as tall as wide. Kept as is to stay in scope; alignment is what the issue asks for.
- Do not touch the hook's run-once behavior, buffer lifetimes, or the COLORIZE shader. Do not touch other prior work (a11y, layout, contrast tests, benchmark, RENDER label).

What I chose not to do: change grid resolution, change the color ramp, add zoom-scaled radius (#9), or loading and error states (#10).

## Proof

- Criterion 1a, 2c: `src/layers/heatmapProjection.test.js`.
- Criterion 2a, 2b: `src/layers/index.test.js` and `src/hooks/useGPUHeatmap.test.js` plus `heatmapProjection.test.js` WGSL-constant tests.
- Criterion 1b: live drive in Playwright Chromium with a SwiftShader WebGPU adapter: HEATMAP and AIRPORTS on, screenshots at about 0N (e.g. lon 0, lat 7, zoom 4), 40N (lon -76, lat 39, zoom 5), and 65N (lon 18, lat 63, zoom 4 or Alaska lon -150, lat 63), plus a numeric check in the page: for a few airports, the heat pixel's screen position (from the rendered bitmap) is within one cell of `map.project([lon, lat])`. Before-and-after screenshots at 60N or 65N show the shift is gone.
