import { createScopedJsonStorage, isPlainObject } from "@/lib/store/scopedStorage";

export type Positions = Record<string, { x: number; y: number }>;

const positionsStorage = createScopedJsonStorage<Positions>({
  prefix: "flowstore:positions:",
  defaultValue: () => ({}),
  validate: (raw) => (isPlainObject(raw) ? (raw as Positions) : null),
  isEmpty: (v) => Object.keys(v).length === 0,
});

export const loadPositions = (specId: string): Positions => positionsStorage.load(specId);
export const savePositions = (specId: string, positions: Positions): void =>
  positionsStorage.save(specId, positions);
