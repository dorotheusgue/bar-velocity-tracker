# Bar Velocity Tracker — Web

React + Vite + TypeScript port of the iOS app. Same architecture (camera →
detector → Kalman tracker → kinematics → rep detector → metrics), runs in any
modern browser, installs as a PWA. Detection uses TensorFlow.js with the
in-browser COCO-SSD model by default; swap in a trained YOLOv8 → TFJS model
when you have one.

## Requirements

* Node 20+
* A modern browser that supports `getUserMedia` + WebGL (Safari 16+, Chrome,
  Firefox, Edge)
* For phones, **HTTPS is mandatory** — browsers only expose the camera over a
  secure context. Localhost is treated as secure for development.

## Run locally

```bash
cd web
npm install
npm run dev -- --host
```

Open the printed URL on a phone on the same Wi-Fi. iOS Safari requires HTTPS
once you leave `localhost`; the easiest local fix is [`ngrok`](https://ngrok.com)
or `vite --https` with a local cert (e.g. `mkcert`):

```bash
mkcert localhost  # produces localhost.pem + localhost-key.pem
npm run dev -- --host --https --cert localhost.pem --key localhost-key.pem
```

## Build

```bash
npm run build       # outputs dist/
npm run preview     # serves dist/ on :4173
```

The `dist/` folder is a static site — drop it on Vercel, Netlify, GitHub
Pages, S3+CloudFront, or any CDN. All required headers are default; no
runtime server is needed.

## Using the app

| Tap | What it does |
|---|---|
| 📏 | Calibration sheet (tap two collars of a bar of known length) |
| 🔄 | Toggle front / rear camera |
| ⚙️ | Debug panel: Kalman/ZUPT sliders, exercise, load, target velocity |
| ⏹ End Set | Finalise the current set; opens the summary with **Save** to persist |
| History tab | Past sessions grouped by day; tap a set to open the chart |

## Detection — the COCO-SSD limitation

COCO-SSD is a generic 80-class object detector. It does not know what a barbell
is. The web detector compensates by:

1. Filtering for high-confidence detections of visually-similar COCO classes
   (`sports ball`, `baseball bat`, `frisbee`, `tennis racket`, …).
2. Rewarding wide-aspect-ratio boxes (bars are long horizontal objects).
3. Tracking the single best-scoring candidate per frame.

This works as a demo and for plates-from-the-front, but it is not production
accurate. For real-world coaching, train a YOLOv8n model on a labeled barbell
dataset and ship it.

### Swapping in a trained YOLOv8n model

1. Train + export (see the iOS README for the dataset / training section):

   ```python
   from ultralytics import YOLO
   model = YOLO("runs/detect/barbell_detector/weights/best.pt")
   model.export(format="tfjs", imgsz=640, half=False, int8=False)
   # produces a barbell_detector_web_model/ folder with model.json + shard bins
   ```

2. Drop the exported folder into `web/public/models/barbell_detector/` so the
   browser can fetch `model.json`.

3. Implement a new `BarDetector` in `src/lib/detector.ts`:

   ```ts
   import * as tf from '@tensorflow/tfjs';

   export class YoloBarDetector implements BarDetector {
     ready: Promise<void>;
     private model: tf.GraphModel | null = null;

     constructor() {
       this.ready = tf.loadGraphModel('/models/barbell_detector/model.json')
         .then((m) => { this.model = m; });
     }

     async detect(video, timestamp) {
       if (!this.model || video.readyState < 2) return null;
       const tensor = tf.tidy(() =>
         tf.image
           .resizeBilinear(tf.browser.fromPixels(video), [640, 640])
           .expandDims(0)
           .div(255)
       );
       const output = (await this.model.executeAsync(tensor)) as tf.Tensor;
       // ... post-process to NMS boxes, pick highest-confidence barbell ...
       tensor.dispose();
       output.dispose();
       return /* BarDetection */ null;
     }
   }
   ```

4. Swap the instantiation in `TrainingEngine`:

   ```ts
   this.detector = new YoloBarDetector();
   ```

The rest of the pipeline (tracker, kinematics, rep detector) is detector-agnostic.

## Architecture

```
camera.ts              getUserMedia wrapper — emits frames via the <video>
   │
   ▼
detector.ts            CocoSsdBarDetector (TF.js) → BarDetection
   │
   ▼
barTracker.ts          KalmanFilter1D smooths yPixel; rolling history
   │
   ▼
kinematics.ts          px → m, windowed least-squares slope, ZUPT
   │                   (subscribers receive velocity & position streams)
   ▼
repDetector.ts         State machine emits Rep on each concentric completion
   │
   ▼
metrics.ts             Live V-loss, avg MCV, peak, best rep; emits SetSummary
   │
   ▼
storage.ts             localStorage — sessions grouped by day
```

All glue lives in `trainingEngine.ts`. React only renders the state it
exposes via `useTrainingState`.

## Kalman tuning

Same defaults and ranges as the iOS version. The debug panel persists tuning
in `localStorage` under `bvt.tuning.v1`.

| Parameter | Effect | Default |
|---|---|---|
| Process noise `q` | Higher = more responsive, noisier | 0.10 |
| Measurement noise `r` | Higher = smoother but more lag | 5.0 |
| ZUPT velocity threshold | Below this, bar is "stationary" | 0.02 m/s |
| ZUPT quiet duration | Time below threshold to trigger ZUPT | 0.15 s |

Presets: **Powerlifting** (q=0.05, r=8.0), **Olympic** (q=0.5, r=3.0),
**Default** (q=0.1, r=5.0).

## Calibration

Pixel → meter scale derived from a single two-tap calibration:

1. Tap 📏.
2. Enter the bar's collar-to-collar length (default 2.2 m).
3. Tap both collars on the camera image.
4. Save.

The scale is keyed by `(facingMode × negotiated camera resolution)` so swapping
cameras prompts a fresh calibration.

## Deploying

| Host | One-liner |
|---|---|
| Vercel | `npx vercel --prod` from `web/` |
| Netlify | `npx netlify deploy --prod --dir=dist` after `npm run build` |
| GitHub Pages | `npm run build`, push `dist/` to `gh-pages` branch; set `base: '/<repo>/'` in `vite.config.ts` |
| Cloudflare Pages | Connect repo, build command `npm run build`, output `web/dist` |

Just remember: HTTPS is mandatory for the camera to work on a real phone.

## Browser limits to know about

* iOS Safari requires the camera permission prompt to be initiated by a user
  gesture and re-prompts every session. The app starts the camera in
  `useEffect`, which Safari treats as user-initiated when wrapped in a page
  navigation; if the camera fails to start, tapping the screen once usually
  unblocks it.
* COCO-SSD on mobile WebGL runs ~10–25 fps on mid-tier phones, vs. ~60 fps
  for native Vision. A trained YOLOv8n in TFJS runs closer to 15–30 fps.
* `performance.now()` is the time source. Timestamps are in seconds.
