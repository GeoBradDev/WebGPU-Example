// maplibre-gl 6 finds its web worker through import.meta.url, which bundlers
// do not follow. Point it at a worker bundled by Vite instead.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
