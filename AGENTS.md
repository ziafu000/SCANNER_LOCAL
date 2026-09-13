# SCANNER Technical Memory

## Maintenance & Architecture
- **Tech Stack:** React 19, Vite, Tailwind CSS, jscanify v1.4.3, opencv.js (local), jspdf, IndexedDB (idb), vite-plugin-pwa.
- **Goal:** Single-file/multi-page scanning utility with focus on iPhone Safari iOS. Simple, fast, no external dependencies (authentication/storage).
- **Project Structure:**
  - `public/`: Assets, OpenCV, icons, manifest/PWA icons.
  - `src/`: Components. `App.jsx` hosts the entire state machine: Camera -> Confirm/Adjust -> Cart -> Gallery/View.
  - `db.js`: IndexedDB wrapper for local gallery.
- **Workflow:**
  - Camera preview renders the native video independently; `requestAnimationFrame` interpolates the edge overlay toward the latest result while a dedicated Web Worker runs throttled OpenCV detection on downscaled frames.
  - Capture -> `canvas` -> `extractPaper` (OpenCV perspective warp) -> Filter (custom image processing) -> user confirmation -> Cart.
  - Gallery -> Browser IndexedDB storage (not persistent across cache clears).
  - Multi-page -> `jspdf` generates blobs locally.
- **PWA/Deployment:**
  - `vite-plugin-pwa` generates an auto-updating service worker that precaches the app shell but excludes the large local `opencv.js` binary.
  - HTTPS requirement: Essential for `getUserMedia`.

## Camera Preview Performance Model
- **Video rendering:** The `<video>` element renders the live feed at native hardware frame rate (up to 60 FPS requested via `frameRate: { ideal: 60, min: 30 }` in `getUserMedia`). Do NOT draw video frames to the overlay canvas.
- **Overlay canvas:** Transparent overlay whose backing size matches the viewfinder container's `getBoundingClientRect()` 1:1; each rAF tick clears it, lerps normalized corners toward the latest Worker result, and maps them through the video's `object-cover` scale and crop before drawing. A missing detection fades the last valid polygon during a 450ms grace period before clearing it.
- **Detection Worker (`public/detection-worker.js`):** OpenCV contour detection runs in a dedicated Web Worker. The main thread transfers downscaled (~360px) `ImageData`; the Worker selects the largest qualifying external contour, rejects border-touching or implausible quadrilaterals, derives corners from its convex hull, and replies with four normalized points. Detection is throttled to ~12 fps (every 80ms) via `isDetecting` lock + `lastDetectTime` timestamp.
- **Capture:** Full-resolution canvas captured from `video`; detection runs at 700px scale (not 360px) for accuracy after the camera frame is frozen, with the frozen smoothed live corners as its fallback.

## Maintaining this file
- **Goal:** Keep developer-only architectural context, avoiding product/audience descriptions properly housed in `README.md`.
- **Update:** If adding new heavy dependencies or critical architecture changes, modify this section.
- **Scope:** Do not copy code, refer to source files.
