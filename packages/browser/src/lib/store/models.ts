import { create } from "zustand";
import type { ResolvedModelsConfig, ModelEntry, CapabilityEndpoint } from "@flowstore/core/files/models";

interface ModelsState {
  config: ResolvedModelsConfig | null;
  set: (config: ResolvedModelsConfig | null) => void;
  clear: () => void;
  // Inference endpoint mutations
  setModelEntry: (id: string, entry: ModelEntry) => void;
  removeModelEntry: (id: string) => void;
  // Capability endpoint mutations
  setCapabilityEndpoint: (name: string, ep: CapabilityEndpoint) => void;
  removeCapabilityEndpoint: (name: string) => void;
}

const EMPTY: ResolvedModelsConfig = { models: {}, default: null, roles: {}, capabilityEndpoints: {}, agents: {} };

export const useModelsStore = create<ModelsState>()((set, get) => ({
  config: null,

  set: (config) => set({ config }),

  clear: () => set({ config: null }),

  setModelEntry: (id, entry) => {
    const prev = get().config ?? EMPTY;
    set({ config: { ...prev, models: { ...prev.models, [id]: entry } } });
  },

  removeModelEntry: (id) => {
    const prev = get().config ?? EMPTY;
    const { [id]: _, ...rest } = prev.models;
    set({ config: { ...prev, models: rest } });
  },

  setCapabilityEndpoint: (name, ep) => {
    const prev = get().config ?? EMPTY;
    set({ config: { ...prev, capabilityEndpoints: { ...prev.capabilityEndpoints, [name]: ep } } });
  },

  removeCapabilityEndpoint: (name) => {
    const prev = get().config ?? EMPTY;
    const { [name]: _, ...rest } = prev.capabilityEndpoints;
    set({ config: { ...prev, capabilityEndpoints: rest } });
  },
}));
