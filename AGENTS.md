# SCANNER Technical Memory

## Maintenance & Architecture
- **Tech Stack:** React 19, Vite, Tailwind CSS, jscanify v1.4.3, opencv.js (local), jspdf, IndexedDB (idb), vite-plugin-pwa.
- **Goal:** Single-file/multi-page scanning utility with focus on iPhone Safari iOS. Simple, fast, no external dependencies (authentication/storage).
- **Project Structure:**
  - `public/`: Assets, OpenCV, icons, manifest/PWA icons.
  - `src/`: Components. `App.jsx` hosts the entire state machine: Camera -> Confirm/Adjust -> Cart -> Gallery/View.
  - `db.js`: IndexedDB wrapper for local gallery.
  - `export.js`: Web Share API (`navigator.share`) export helper for JPEG images (Apple Photos) with download fallback and file download helper.
  - `geometry.js`: Geometric quad validation (`isReasonableQuad`) and corner ordering (`orderPoints`).
- **Workflow:**
  - Camera preview uses camera stream -> `requestAnimationFrame` -> direct canvas rendering and OpenCV corner detection (7x7 blur, two-pass Canny, multi-epsilon convex hull, hand occlusion correction, geometric quad validation) -> polygon drawing on the same canvas.
  - Capture -> canvas-based OpenCV corner detection and perspective warp -> Filter (custom image processing) -> user confirmation -> Cart.
  - Gallery -> Browser IndexedDB storage (not persistent across cache clears).
  - Multi-page / Export -> `jspdf` generates PDF blobs locally; `export.js` handles JPEG image sharing to Apple Photos via Web Share API or individual page downloads.
- **PWA/Deployment:**
  - `vite-plugin-pwa` generates an auto-updating service worker that precaches the app shell but excludes the large local `opencv.js` binary.
  - HTTPS requirement: Essential for `getUserMedia`.

## Maintaining this file
- **Goal:** Keep developer-only architectural context, avoiding product/audience descriptions properly housed in `README.md`.
- **Update:** If adding new heavy dependencies or critical architecture changes, modify this section.
- **Scope:** Do not copy code, refer to source files.
