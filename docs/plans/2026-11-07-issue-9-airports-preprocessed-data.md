# Plan: Airports layer downloads a 12.7 MB unpinned third-party CSV and parses it on the main thread (issue #9)

Risk tier: High. Changes the airports data contract (CSV at runtime to a committed compact JSON), the deck.gl layer rendering (visual, only checkable in a browser), async loading and its retry path, and touches more than a few files (script, data, hook, layers, App, several tests, README, ESLint config).

Domain skills:
- vercel-react-best-practices: invoke (useAirports hook and App wiring; avoid re-filtering 48k rows on every render).
- context7-plugin:docs (deck.gl ScatterplotLayer radius props, Vite `?worker` if needed): invoke.
- chrome-devtools-mcp / headless Chrome for the live drive: invoke as tooling (network log, longtask observer, screenshots).
- frontend-design: not applicable because no new UI is added; only point radius and filtering change.
- django, fastapi, expo, payments, email skills: not applicable because this is a static Vite SPA.

## Acceptance criteria

1. No third-party data fetch for airports on startup: the app fetches airports same-origin from `/data/airports.json`; a startup network log shows no request to `raw.githubusercontent.com`.
2. The committed data comes from OurAirports pinned to commit `64af12951161ed52bc733eb4101224643c48850a` of `davidmegginson/ourairports-data`, produced by `npm run data:airports`, with a metadata record (source URL, commit SHA, fetch date, row counts per stage, license: public domain). CI does not run the script or touch the network for it.
3. The committed airports file excludes `closed`, `heliport`, `seaplane_base`, and `balloonport` rows and rows without finite coordinates; it is under about 2 MB uncompressed (size and gzip size reported).
4. Airport parsing does not block the main thread for more than 50 ms: the longest long task during airport load, measured with a `PerformanceObserver` for `longtask` in Chrome on the production build, is reported. If parsing the file on the main thread produces a long task over 50 ms that is attributable to it, parsing moves into a Web Worker (Vite `?worker`) and the measurement is repeated.
5. At zoom 2 with all layers on (airports, ports, heatmap), basemap country labels stay legible: the airports points layer draws only `large_airport` and `medium_airport`, with a zoom-scaled radius (`radiusUnits: 'meters'` with `radiusMinPixels` and `radiusMaxPixels`). Screenshot at zoom 2, 1440px wide.
6. The heatmap bins all included airports (large, medium, and small), so its density meaning is unchanged apart from dropping heliports, seaplane bases, and balloonports.
7. The AIRPORTS layer count in the layer panel equals the number of points drawn (large plus medium), not the size of the heatmap set.
8. Prior work keeps working: #10 loading, `LOAD FAILED`, and `RETRY` for airports against the new same-origin URL (tests updated); #15 heatmap projection; #4/#5/#7 a11y, layout, and contrast tests; #8 RENDER; #11 benchmark. The full gate is green.
9. README data sources, network access note, scripts table, project layout, and known limitations, and the `src/config/sources.js` comments, describe the new data path.

## Files that change

- `scripts/airports-transform.js` (new): pure functions, no I/O, no Node globals.
  - `parseCSV(text)`: RFC 4180 parser over the whole text: quoted fields with commas, doubled quotes, quoted newlines, CRLF and LF, trailing newline, optional UTF-8 BOM. Returns an array of string arrays.
  - `transformAirports(csvText)`: maps columns by header name (`type`, `name`, `latitude_deg`, `longitude_deg`), never by index; drops `EXCLUDED_TYPES = ['closed', 'heliport', 'seaplane_base', 'balloonport']` and any type not in `INCLUDED_TYPES = ['large_airport', 'medium_airport', 'small_airport']` (counted as excluded, so a new upstream type does not slip in silently); drops rows with non-finite or out-of-range coordinates; rounds lon/lat to 3 decimals (about 110 m, enough for a 1024 x 512 heatmap and point display). Returns `{ data, counts }` where `data` is the columnar object below and `counts` is `{ total, included, byType: {...}, droppedType, droppedCoords, inputByType: {...} }` (`inputByType` added during implementation so the meta file records the upstream count per type, including excluded and unknown types). Output order is stable (input order).
  - Throws a clear error if a required header is missing.
- `scripts/build-airports.mjs` (new): the CLI. Constants `SOURCE_REPO`, `SOURCE_SHA = '64af12951161ed52bc733eb4101224643c48850a'`, `SOURCE_URL = https://raw.githubusercontent.com/davidmegginson/ourairports-data/<SHA>/airports.csv`. Fetches with global `fetch` (Node 20+), fails on non-200, runs `transformAirports`, writes `public/data/airports.json` (minified) and `public/data/airports.meta.json` (pretty, 2-space). Meta: `{ source: 'OurAirports', sourceUrl, repo, commit, fetchedAt (ISO date), license: 'Public domain (OurAirports data)', licenseUrl: 'https://ourairports.com/data/', counts, rounding: '3 decimal places', bytes }`. Paths resolved from `import.meta.url`, not cwd. Main runs only when executed directly (the module is not imported by tests).
- `public/data/airports.json` (new, generated, committed). Schema, columnar to keep it small:
  `{ "version": 1, "types": ["large_airport","medium_airport","small_airport"], "lon": [...], "lat": [...], "name": [...], "type": [0,1,2,...] }` where `type[i]` indexes `types`. Expected about 48,000 rows, about 1.97 MB, about 620 KB gzip.
- `public/data/airports.meta.json` (new, generated, committed).
- `package.json`: add script `"data:airports": "node scripts/build-airports.mjs"`. No new dependencies.
- `eslint.config.js`: add a block for `scripts/**/*.{js,mjs}` with `globals.node` (and include `.mjs` in linted files). This adds globals for Node files; it does not loosen any rule.
- `src/config/sources.js`: replace `OURAIRPORTS_CSV_URL` with `AIRPORTS_DATA_URL = '/data/airports.json'`; comment names the generated file, the script, the pinned upstream, and the license. Fix nothing else there (the ports comment is out of scope).
- `src/data/airports.js` (new) or inside `src/hooks/useAirports.js`: pure `decodeAirports(json)` that validates the shape (`types`, `lon`, `lat`, `name`, `type` are arrays of equal length; throws `Error('Airport data is malformed')` otherwise), skips rows with non-finite coordinates or unknown type index, and returns `Array<{ lon, lat, name, type }>`; and `selectMajorAirports(airports)` returning only `large_airport` and `medium_airport`, in order. Keep the object shape `{ lon, lat, name, type }` so the popup and heatmap are unchanged.
- `src/hooks/useAirports.js`: fetch `AIRPORTS_DATA_URL`, `res.json()`, `decodeAirports`, and compute `majorAirports` once per load (not per render). Return `{ airports, majorAirports, loaded, error, retry }`. Remove `parseAirportCSV` and `parseCSVRow`. Retry, cancellation, and stable `retry` unchanged. A malformed file sets `error` (shows `LOAD FAILED`).
- `src/App.jsx`: heatmap gets `airports` (all included); `layerData.airports` gets `majorAirports`; the AIRPORTS layer status count is `majorAirports.length`. `airportsSettledEmpty` keeps using `airports.length` (the heatmap set).
- `src/layers/index.js`: airports `ScatterplotLayer` uses `radiusUnits: 'meters'`, `getRadius: (d) => d.type === 'large_airport' ? <large m> : <medium m>`, `radiusMinPixels`, `radiusMaxPixels`. Starting values: large 12000 m, medium 6000 m, `radiusMinPixels: 1.5`, `radiusMaxPixels: 8`; tune only by the zoom 2 screenshot and a zoom 6 to 8 screenshot (points still clickable), and record the final values in this plan if they change. Ports layer (added after review finding C1: 5 px ports covered European country labels at zoom 2): same treatment, `radiusUnits: 'meters'`, `getRadius: 6000`, `radiusMinPixels: 2`, `radiusMaxPixels: 8`, tested in `src/layers/index.test.js`; the ports data and its comment stay unchanged.
- Tests:
  - `scripts/airports-transform.test.js` (new): fixture CSV (inline string or `scripts/fixtures/airports.sample.csv`) with every type, a quoted name containing commas, a doubled quote, a quoted newline, CRLF line endings, a blank and a non-numeric coordinate, a BOM, and columns in a non-default order to prove header mapping. Asserts excluded types dropped, counts per type, rounding, output order, missing header throws.
  - `src/hooks/useAirports.test.js`: replace the `parseAirportCSV` block with `decodeAirports` and `selectMajorAirports` tests (valid, length mismatch, non-array, unknown type index, non-finite coordinates); retry tests use the new URL and JSON responses; add a test that a malformed body sets `error`.
  - `src/layers/index.test.js`: airports layer props: `radiusUnits === 'meters'`, `radiusMinPixels` and `radiusMaxPixels` set, `getRadius` larger for large than medium.
  - `src/App.header.test.jsx`, `src/App.status.test.jsx`, `src/App.emptyAirports.test.jsx`: switch fetch mocks to `AIRPORTS_DATA_URL` with JSON bodies; add or adjust an App test that the AIRPORTS count shows the large plus medium count while the heatmap hook receives all airports.
  - Optional committed-data sanity test (`src/data/airports.data.test.js`): reads `public/data/airports.json` from disk, asserts it decodes, has equal-length columns, no excluded types (only the three `types`), more than 40,000 rows, and file size under 2.2 MB. It does not hit the network.
- `README.md`: airports bullet (large and medium drawn with zoom-scaled size; heatmap uses all included airports), network access (airports bundled), scripts table (`npm run data:airports`, not run in CI, needs network), data sources row (pinned commit SHA, fetch date, `public/data/airports.json` and `.meta.json`, filtered types, public domain), project layout (`scripts/`, the new data files), known limitations (replace the GitHub raw line; note small airports are not drawn as points; data is a snapshot until the script is rerun).

## Order of work

1. Commit this plan alone (`docs: plan for issue 9`).
2. TDD the transform: write `scripts/airports-transform.test.js` red, then `scripts/airports-transform.js`, plus the ESLint block. Commit.
3. Write `scripts/build-airports.mjs` and the npm script; run `npm run data:airports` once (network, local only); commit the script with the generated `public/data/airports.json` and `.meta.json`. Report file size and gzip size (`wc -c`, `gzip -9c | wc -c`).
4. TDD `decodeAirports` / `selectMajorAirports` and the hook change (tests red, then code). Update `sources.js`. Switch the App test fetch mocks to `AIRPORTS_DATA_URL` with JSON bodies in the same commit (moved here from step 6 so every commit is green). Commit.
5. TDD the layer props, then `src/layers/index.js`. Commit.
6. Update App wiring and App tests. Commit.
7. Full gate. Then the live drive (below). Measure the long task; if over 50 ms and attributable to airport parsing, add the Worker step (move `decodeAirports` behind a Vite `?worker` that fetches and decodes, keep the hook's retry and cancellation, terminate the worker on cleanup, keep a jsdom-friendly fallback path for tests), edit this plan in the same commit, and re-measure.
8. README and comment updates. Commit.

Implementation notes (recorded during the work):
- Step 8 (README) was committed before step 7 so the gate and live drive cover the final tree.
- Radius values kept at the starting values (large 12000 m, medium 6000 m, `radiusMinPixels: 1.5`, `radiusMaxPixels: 8`): at zoom 2 (1440 x 900, all layers, heatmap READY) country labels stay legible, and at zoom 6 points are clickable (Frankfurt Main popup opened).
- Worker step not taken. Headless Chrome 157, SwiftShader, production preview: the app's `res.json()` on `/data/airports.json` takes about 18 to 22 ms including the body read, and an in-page `JSON.parse` plus decode of the real file takes about 5 to 8 ms. Long tasks over 50 ms do exist (about 60 to 160 ms), but with the airports response held 5 s they start only after `res.json()` has resolved, a CPU profile puts 1.7 ms of them in `decodeAirports` and `selectMajorAirports` and the rest in native WebGL work around deck.gl render frames, and with the airports and heatmap layers unticked (data still fetched, parsed, decoded, and the heatmap computed) no long task follows the airports response. They come from deck.gl's first draw of the layers and from MapLibre and deck init, not from parsing.

## Risks

- A quoted newline in an upstream name would break a line-based parser: the parser works on the whole text and is tested for it.
- Upstream column order or new types: header mapping and an explicit include list, both tested.
- Thin points at zoom 2 may be hard to click: check at zoom 5 to 8 that popups still open; `radiusMinPixels` keeps them visible.
- Count semantics change (layer count drops from about 74,000 to about 5,300): intended; README says so.
- App tests that mock the CSV URL break: update them to the new URL and JSON body; these are fixture updates, not frozen tests.
- `res.json()` parse time: measured in the browser; Worker fallback planned.
- File size: about 1.97 MB at 3 decimals; if a richer schema is wanted later it will exceed the target.
- Riskiest step: the layer radius values, since only a screenshot proves legibility.
- Chosen not to do: a type filter UI, drawing small airports at high zoom (follow-up), FlatGeobuf or binary formats, running the script in CI, changing the ports data or its misattributed comment.

## Proof

- Criterion 1: App and hook tests assert the fetch goes to `/data/airports.json`; live drive network log of the preview build shows no `raw.githubusercontent.com` request.
- Criterion 2: `scripts/build-airports.mjs` constants and `public/data/airports.meta.json` content; CI workflow unchanged (no script step).
- Criterion 3: transform unit tests; optional committed-data test; `wc -c` and gzip size in the PR.
- Criterion 4: `PerformanceObserver({ type: 'longtask', buffered: true })` on `npm run preview` in headless Chrome, longest task between navigation and the AIRPORTS count appearing, reported in ms with attribution where available; plus a `performance.now()` timing of `JSON.parse` plus `decodeAirports` on the real file in the page.
- Criterion 5: layer props test; screenshot at zoom 2, 1440 x 900, all layers on (SwiftShader WebGPU for heatmap), country labels readable; a zoom 6 screenshot showing points still visible and a click opening the popup.
- Criterion 6 and 7: App test asserting the heatmap hook receives all airports and the panel count equals large plus medium; live drive reads the AIRPORTS count text.
- Criterion 8: full gate green; live drive: block `/data/airports.json` (route abort), see `LOAD FAILED`, unblock, press `RETRY`, see the count; heatmap reaches `READY` with SwiftShader.
- Criterion 9: README and `sources.js` diff, doc finder in Phase 8.
