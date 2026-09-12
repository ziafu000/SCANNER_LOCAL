# SCANNER Technical Memory

## Maintenance & Architecture
- **Tech Stack:** React 19, Vite, Tailwind CSS, jscanify v1.4.3, opencv.js (local), jspdf, IndexedDB (idb), vite-plugin-pwa.
- **Goal:** Single-file/multi-page scanning utility with focus on iPhone Safari iOS. Simple, fast, no external dependencies (authentication/storage).
- **Project Structure:**
  - `public/`: Assets, OpenCV, icons, manifest/PWA icons.
  - `src/`: Components. `App.jsx` hosts the entire state machine: Camera -> Review -> Adjust -> Gallery/Pages.
  - `db.js`: IndexedDB wrapper for local gallery.
- **Workflow:**
  - Camera preview uses camera stream -> `requestAnimationFrame` -> `jscanify`.
  - Capture -> `canvas` -> OpenCV perspective warp -> Filter (custom image processing).
  - Gallery -> Browser IndexedDB storage (not persistent across cache clears).
  - Multi-page -> `jspdf` generates blobs locally.
- **PWA/Deployment:**
  - `vite-plugin-pwa` handles service worker generation. `vite.config.js` Workbox config uses `skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches`. `opencv.js` excluded from precache via `globIgnores` to prevent cache bloat.
  - `main.jsx` registers a `controllerchange` listener on `navigator.serviceWorker` to `window.location.reload()` when a new SW takes control.
  - HTTPS requirement: Essential for `getUserMedia`.
- **Readiness Gate:** Camera screen has `isScannerReady = isOpenCvLoaded && isCameraPlaying`. The capture button is disabled and pulses until both flags are true. `isCameraPlaying` is set inside the `video.onplaying` event (not after `await play()`).
- **Capture Fallback:** On capture, contour detection runs on scaled preview frame first, then retries on full-res frame. If detection fails entirely, the app navigates to the manual `adjust` screen instead of silently saving a full-frame distorted image.

## Maintaining this file
- **Goal:** Keep developer-only architectural context, avoiding product/audience descriptions properly housed in `README.md`.
- **Update:** If adding new heavy dependencies or critical architecture changes, modify this section.
- **Scope:** Do not copy code, refer to source files.
