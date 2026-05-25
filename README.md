# Bar Velocity Tracker — iOS (Phase 1)

Camera-based barbell velocity tracking for velocity-based training (VBT). Phase 1
ships the full video pipeline: capture → detection → smoothing → kinematics →
rep segmentation → set metrics → SwiftData persistence. Phase 2 (BLE/IMU) is
stubbed behind a `BarMotionSource` protocol so swapping the source requires no
changes downstream.

## Requirements

| | |
|---|---|
| Xcode | 15.0+ |
| iOS deployment target | 17.0 (SwiftData) |
| Swift | 5.9+ |
| Device | iPhone with camera (uses `.hd1920x1080` preset; rear camera by default) |
| Dependencies | None — Vision, CoreML, AVFoundation, Combine, SwiftUI, Swift Charts, SwiftData all ship with the OS |

## Running

1. Open `BarVelocityTracker.xcodeproj` in Xcode.
2. Select an iPhone (real device — the simulator has no camera).
3. Set a development team under *Target → Signing & Capabilities*.
4. Build & run.
5. Accept the camera-permission prompt on first launch.

## Using the app

| Tap | What it does |
|---|---|
| Ruler icon | Open the calibration sheet |
| Camera-flip icon | Toggle front / rear camera |
| Sliders icon | Open debug settings (Kalman tuning, ZUPT, target velocity, exercise/load) |
| `End Set` | Finalise the current set and show the summary sheet |
| `Save Set` (in summary) | Persist the set under today's session in SwiftData |
| History tab | Browse past sessions and per-set rep charts |

## Calibration

Velocity is in real m/s, so the system needs a pixels-per-meter scale.

1. Place a barbell horizontally in frame so you can see both collars clearly.
2. Tap the ruler icon.
3. Enter the bar's collar-to-collar length (default 2.2 m — a men's Olympic bar).
4. Tap the left collar, then the right collar, on the live image.
5. Tap **Save**.

The scale is stored in `UserDefaults`, keyed by `(camera × resolution)`. Swap
cameras or change presets and you'll be prompted to recalibrate.

If the bar is not visible for more than ~3 seconds the HUD shows a re-calibrate
hint. Always recalibrate when you move the phone.

## Kalman tuning

Open the debug panel (sliders icon) and adjust:

| Parameter | Effect | Defaults |
|---|---|---|
| Process noise `q` | Higher = more responsive, noisier | 0.10 |
| Measurement noise `r` | Higher = smoother but more lag | 5.0 |
| ZUPT velocity threshold | Below this, the bar is "stationary" | 0.02 m/s |
| ZUPT quiet duration | Time at-or-below threshold to trigger ZUPT | 0.15 s |

Presets in the panel:

* **Powerlifting** — `q = 0.05, r = 8.0` (slow, heavy bar)
* **Olympic** — `q = 0.5, r = 3.0` (fast pulls, snap)
* **Default** — `q = 0.1, r = 5.0`

The values are stored in `@AppStorage` and applied live without restart.

## Architecture

```
CameraManager      AVFoundation, publishes CMSampleBuffer @ 30–60fps
   │
   ▼
BarDetector        Vision rectangles + optional CoreML object detector
   │  BarDetection
   ▼
BarTracker         Kalman-smoothed (timestamp, yPixel) history
   │  BarPosition
   ▼
KinematicsEngine   Pixels → meters, windowed least-squares velocity, ZUPT
   │  Publishes velocity & position (BarMotionSource)
   ▼
RepDetector        State machine: idle→eccentric→transition→concentric→top
   │  Rep
   ▼
MetricsEngine      Per-set stats; emits SetSummary on End Set
   │
   ▼
SwiftData          Session → Set → Rep entities (HistoryView reads back)
```

`RepDetector` and `MetricsEngine` only know about `BarMotionSource`, so the
Phase-2 `BLEIMUManager` can drop in unchanged.

## CoreML model swap

Phase 1 falls back to `VNDetectRectanglesRequest` (aspect ratio ≥ 8:1,
confidence ≥ 0.6). To swap in a trained model:

1. Train YOLOv8n on a barbell-only dataset (see `Training pipeline` below).
2. Export to CoreML — the file must be named `barbell_detector.mlpackage`:

   ```python
   from ultralytics import YOLO
   YOLO("runs/detect/barbell_detector/weights/best.pt").export(
       format="coreml", imgsz=640, nms=True, half=False, int8=False
   )
   ```

3. Drag `barbell_detector.mlpackage` into Xcode (target membership =
   BarVelocityTracker).
4. Rebuild. `BarDetector` will discover the compiled model in the bundle and
   prefer it; the rectangle detector becomes the fallback when CoreML returns
   no result for a frame.

### Training pipeline (summary)

| Step | Tooling |
|---|---|
| Dataset | ≥ 500 frames at 1920×1080 across lighting / angles / loads. Roboflow's free tier works well for labeling. |
| Label | Single class `barbell`. Tight box around the **shaft only**, not plates. |
| Augment | Brightness ±30%, blur up to 2 px, mosaic. **Disable horizontal flip** — gyms are asymmetric. |
| Train | `yolo task=detect mode=train model=yolov8n.pt data=… epochs=100 imgsz=640 batch=16` |
| Validate | Target mAP@0.5 ≥ 0.85 |
| Export | `format="coreml", nms=True` |

## Edge cases

| Scenario | Behaviour |
|---|---|
| Bar partially out of frame | Detection drops, `isTracking → false`, no rep emitted |
| Reps < 0.5 s apart | Debounced (treated as one rep) |
| No bar for > ~3 s | HUD shows a "Bar not visible / re-calibrate" warning |
| Paused / very slow reps | ZUPT thresholds err on the conservative side; tune in debug |
| Lighting changes | Vision detectors re-run without crashing |
| CoreML returns nothing | Silent fallback to rectangle detector |

## Phase 2 hook

`BarMotionSource`:

```swift
protocol BarMotionSource: AnyObject {
    var velocityPublisher: AnyPublisher<Double, Never> { get }
    var positionPublisher: AnyPublisher<Double, Never> { get }
}
```

`KinematicsEngine` conforms today. `BLEIMUManager` is a stub conformer with a
TODO list (BLE scan → GATT → Madgwick → ZUPT → integration). Call
`RepDetector.bind(to:)` to swap sources at runtime.

## Project layout

```
BarVelocityTracker/
  App/             Entry point, Info.plist
  Camera/          CameraManager (AVCaptureSession)
  Vision/          BarDetector (Vision + CoreML)
  Tracking/        KalmanFilter1D, BarTracker
  Calibration/     CalibrationManager
  Kinematics/      BarMotionSource, KinematicsEngine
  Reps/            Rep, RepDetector
  Metrics/         SetSummary, MetricsEngine
  BLE/             BLEIMUManager (Phase 2 stub)
  Persistence/     SwiftData @Model entities
  ViewModels/      LiveTrainingViewModel
  Views/           SwiftUI screens
  Assets.xcassets  AppIcon, AccentColor
```
