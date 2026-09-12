# SCANNER Technical Memory

## Maintenance & Architecture
- **Tech Stack:** React 19, Vite, Tailwind CSS, jscanify v1.4.3, opencv.js (local), jspdf, IndexedDB (idb), vite-plugin-pwa.
- **Goal:** Single-file/multi-page scanning utility with focus on iPhone Safari iOS. Simple, fast, no external dependencies (authentication/storage).
- **Project Structure:**
  - `public/`: Assets, OpenCV, icons, manifest/PWA icons.
  - `src/`: Components. `App.jsx` hosts the entire state machine: Camera -> Confirm/Adjust -> Cart -> Gallery/View.
  - `db.js`: IndexedDB wrapper for local gallery.
- **Workflow:**
  - Camera preview renders the native video independently; `requestAnimationFrame` draws the latest edge overlay while a dedicated Web Worker runs throttled OpenCV detection on downscaled frames.
  - Capture -> `canvas` -> `extractPaper` (OpenCV perspective warp) -> Filter (custom image processing) -> user confirmation -> Cart.
  - Gallery -> Browser IndexedDB storage (not persistent across cache clears).
  - Multi-page -> `jspdf` generates blobs locally.
- **PWA/Deployment:**
  - `vite-plugin-pwa` generates an auto-updating service worker that precaches the app shell but excludes the large local `opencv.js` binary.
  - HTTPS requirement: Essential for `getUserMedia`.

## Camera Preview Performance Model
- **Video rendering:** The `<video>` element renders the live feed at native hardware frame rate (up to 60 FPS requested via `frameRate: { ideal: 60, min: 30 }` in `getUserMedia`). Do NOT draw video frames to the overlay canvas.
- **Overlay canvas:** Transparent overlay (`clearRect` each frame); only the detected document boundary (green polygon + corner dots) is drawn per rAF tick using the most recent corners from the Worker.
- **Detection Worker (`src/detectionWorker.js`):** OpenCV contour detection runs in a dedicated Web Worker. The main thread posts a downscaled (~360px) ImageBitmap to it; the Worker replies with the four corner points. Throttled to ~12 fps (every 80ms) via `isDetecting` lock + `lastDetectTime` timestamp.
- **Capture:** Full-resolution canvas captured from `video`; detection runs at 700px scale (not 360px) for accuracy since the camera is already stopped.

## Maintaining this file
- **Goal:** Keep developer-only architectural context, avoiding product/audience descriptions properly housed in `README.md`.
- **Update:** If adding new heavy dependencies or critical architecture changes, modify this section.
- **Scope:** Do not copy code, refer to source files.
