/** Shared types across the camera/vision/kinematics/rep pipeline. */

export interface BoundingBox {
  /** All values normalised 0..1, origin = top-left (DOM convention). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarDetection {
  boundingBox: BoundingBox;
  /** Frame timestamp in seconds (performance.now() / 1000 at capture). */
  timestamp: number;
  confidence: number;
  source: 'coco-ssd' | 'rectangles' | 'custom';
  /** The detector's reported class label (for debug). */
  label?: string;
}

export interface BarPosition {
  timestamp: number;
  /** Smoothed vertical pixel position, origin top-left. */
  yPixel: number;
  xPixel: number;
  boundingBox: BoundingBox;
  confidence: number;
}

export interface Rep {
  id: string;
  index: number;
  meanConcentricVelocity: number; // m/s
  peakConcentricVelocity: number; // m/s
  rangeOfMotion: number; // meters
  concentricDuration: number; // seconds
  timestamp: number; // ms (Date.now())
  /** Video-time span of the concentric phase (seconds), set by offline analysis. */
  videoStart?: number;
  videoEnd?: number;
}

export interface SetSummary {
  id: string;
  reps: Rep[];
  velocityLossPercent: number;
  averageMCV: number;
  averagePeak: number;
  bestRepId: string | null;
  startedAt: number;
  endedAt: number;
  exerciseName: string;
  loadKg: number;
  targetVelocity: number;
}

export interface StoredSession {
  id: string;
  date: number;
  sets: SetSummary[];
}

export type RepPhase = 'idle' | 'eccentric' | 'transition' | 'concentric' | 'topOfRep';

export interface CalibrationKey {
  facing: 'user' | 'environment';
  resolution: string; // e.g. "1920x1080"
}
