# Bar Velocity Tracker — Web

A Metric/RepSpeed-style velocity-based-training analyser that runs entirely in
the browser. Upload a lift video, fit a square over a plate, and it tracks the
bar through every frame, then shows the bar path, a velocity–time chart, and
per-rep VBT metrics. No model downloads, no server — ~60 KB gzipped, all
analysis on-device.

## How it works

**Record-then-analyse, offline two-pass** (the same model Metric uses):

```
videoFile.ts           object-URL loader, first-frame paint fix for iOS Safari
   │
frameWalker.ts         Pass 1 driver — sequential decode at reduced playbackRate
   │                   captured per-frame via requestVideoFrameCallback, then
   │                   deterministic seek-backfill of any missed frames.
   │                   Every frame index processed exactly once.
   ▼
colorTracker.ts        Colour-blob plate tracker: HSV mask of the marked
   │                   plate's colour inside a predicted search window →
   │                   connected components → best blob by size × proximity →
   │                   sub-pixel centroid. Blur-tolerant: a smeared coloured
   │                   plate is still a coloured region.
   ▼
trajectory.ts          Dense (t, x, y, confidence) trajectory; per-frame search
   │                   window predicted from nearest detections on either side.
   ▼
offlineKinematics.ts   Pass 2 — gap-fill, zero-phase Savitzky–Golay smoothing
   │  savitzkyGolay.ts and velocity from the same SG fit's derivative kernel
   │                   (no lag, no peak clipping), non-causal ZUPT.
   ▼
repDetector.ts         Velocity-threshold state machine → Rep per concentric
metrics.ts             Set aggregates: avg MCV, avg peak, velocity loss, best rep
storage.ts             localStorage sessions, grouped by day (History tab)
```

Orchestrated by `trainingEngine.ts` (`analyze()` → progress → results state).
Smoothing-knob changes re-run only Pass 2 from the cached trajectory.

## Using it

1. **Upload** an MP4/MOV clip (tips shown on the start screen).
2. **Fit the square**: scrub to a clear frame, drag the square over a plate
   (pinch or corner handle to resize), confirm the plate diameter
   (450 mm default — Olympic), Save. The square is both the **scale**
   (side = diameter) and the **colour sample** the tracker locks onto.
3. Analysis runs with a progress bar (faster than real-time on most clips).
4. **Review**: bar path drawn over the video (traversed portion highlighted),
   plate marker at the playhead, velocity readout, and a results panel with
   set stats, a velocity chart (drag it to scrub; rep spans shaded), and a
   tappable per-rep list.
5. **Save set** → History tab (grouped by day, MCV trend per session).

### What tracks well

- **Coloured bumper plates** (red/blue/yellow/green) — ideal.
- Iron/silver/black plates: put a strip of **bright tape** on the bar end and
  fit the square over that. Colour is the signal; grey has none.
- Side-on camera (≤ ~25° off-axis), well-lit, whole bar in frame.
- Fast lifts: record at high shutter speed / 120–240 fps to limit motion blur.

The **track %** chip is honest — below ~70 % means the numbers aren't
trustworthy; re-fit the square or improve the recording.

## Debug sheet (⚙️)

- Exercise / load / target velocity (colour-codes the readout and rep list).
- Colour tracker: hue tolerance, saturation min, min confidence
  (require **Re-analyse**).
- Smoothing: SG window & order, ZUPT thresholds (instant — Pass 2 only).
- Readouts incl. **Max drop accel**: on any bar drop this should read ≈ 9.81
  m/s², validating the whole pixels→metres→time chain end-to-end.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # static dist/, deploys anywhere (vercel.json included)
```

React + Vite + TypeScript. No runtime dependencies beyond React.
