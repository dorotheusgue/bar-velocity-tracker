import type { CalibrationKey } from '../types';

const STORAGE_KEY = 'bvt.calibration.metersPerPixel.v1';
const KNOWN_DISTANCE_KEY = 'bvt.calibration.knownDistanceMeters';

interface StoredMap {
  [key: string]: number;
}

/**
 * Holds the meters-per-pixel scale derived from a two-point tap calibration.
 * Persisted in localStorage, keyed by `(facingMode × resolution)`.
 */
export class CalibrationManager {
  private mppByKey: StoredMap;
  private currentKey: CalibrationKey | null = null;
  metersPerPixel: number | null = null;
  knownDistanceMeters: number;

  private listeners: Set<() => void> = new Set();

  constructor() {
    this.mppByKey = readJson<StoredMap>(STORAGE_KEY) ?? {};
    this.knownDistanceMeters = readJson<number>(KNOWN_DISTANCE_KEY) ?? 2.2;
  }

  load(key: CalibrationKey) {
    this.currentKey = key;
    this.metersPerPixel = this.mppByKey[serialize(key)] ?? null;
    this.notify();
  }

  setKnownDistance(meters: number) {
    if (meters <= 0) return;
    this.knownDistanceMeters = meters;
    localStorage.setItem(KNOWN_DISTANCE_KEY, JSON.stringify(meters));
    this.notify();
  }

  calibrate(pixelDistance: number) {
    if (!this.currentKey || pixelDistance <= 0) return;
    const mpp = this.knownDistanceMeters / pixelDistance;
    this.metersPerPixel = mpp;
    this.mppByKey[serialize(this.currentKey)] = mpp;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mppByKey));
    this.notify();
  }

  calibrateFromPoints(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    this.calibrate(Math.sqrt(dx * dx + dy * dy));
  }

  clear() {
    if (!this.currentKey) return;
    delete this.mppByKey[serialize(this.currentKey)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mppByKey));
    this.metersPerPixel = null;
    this.notify();
  }

  convertPixelsToMeters(pixels: number): number {
    if (this.metersPerPixel == null) return 0;
    return pixels * this.metersPerPixel;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}

function serialize(key: CalibrationKey): string {
  return `${key.facing}|${key.resolution}`;
}

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
