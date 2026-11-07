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
}))

useMapStore.getInitialState = () => ({ ...initialState })