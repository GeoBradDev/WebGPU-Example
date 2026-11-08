import { create } from 'zustand'
import { DEFAULT_VIEW } from '../config/sources.js'

const initialState = {
  viewport: {
    ...DEFAULT_VIEW,
    pitch: 0,
    bearing: 0,
  },
  layerVisibility: {
    airports: true,
    ports: true,
    heatmap: true,
  },
  stressCount: 0,
  selectedFeature: null,
  // Issue #10: render device and basemap health, written by MapView from the
  // deck.gl and MapLibre callbacks, read by the GPU panel and the header.
  render: { status: 'detecting', type: null, renderer: null },
  basemapFailed: false,
}

export const useMapStore = create((set) => ({
  ...initialState,
  setViewport: (viewport) => set({ viewport }),
  setLayerVisibility: (layer, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layer]: visible },
    })),
  setStressCount: (count) => set({ stressCount: count }),
  setSelectedFeature: (feature) => set({ selectedFeature: feature }),
  setRender: (render) => set({ render }),
  setBasemapFailed: (basemapFailed) => set({ basemapFailed }),
}))

useMapStore.getInitialState = () => ({ ...initialState })