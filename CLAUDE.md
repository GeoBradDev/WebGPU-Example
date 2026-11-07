# CLAUDE.md

WebGPU Groundtruth: a React 19 + Vite single-page map. MapLibre GL basemap (CARTO dark-matter), deck.gl overlay layers for airports, ports, and stress-test points, and WebGPU compute shaders for an airport heatmap and a throughput readout. State lives in a zustand store (`src/store/mapStore.js`); data URLs are in `src/config/sources.js`. See `README.md` for details.

## Gate

Run from the repo root, in order. All must pass before a change is done (CI runs the same steps):

```sh
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

## Rules

- JavaScript only (`.js` / `.jsx`). No TypeScript.
- No emojis in code, comments, docs, or commit messages.
- No em dashes; use commas, periods, or colons.
- Keep render pure: no `Math.random`, `performance.now`, or other impure calls during render (`react-hooks/purity` lint rule). Do not add `eslint-disable` comments or loosen lint rules to get green.
- Tests use Vitest + Testing Library in jsdom. jsdom has no WebGL or WebGPU, so mock `MapView` and GPU hooks in component tests.

## Git exception

Agents running the /work-issue workflow may commit and push only on their own `issue-<N>-*` branch and open a PR against `main`. Never commit or push to `main`, never force-push, and never merge their own PR or enable auto-merge.
