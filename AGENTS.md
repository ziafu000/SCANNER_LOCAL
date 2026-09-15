# SCANNER Technical Memory

## Maintenance & Architecture
- **Tech Stack:** React 19, Vite, Tailwind CSS, jscanify v1.4.3, opencv.js (local), jspdf, IndexedDB (idb), vite-plugin-pwa.
- **Goal:** Single-file/multi-page scanning utility with focus on iPhone Safari iOS. Simple, fast, no external dependencies (authentication/storage).
- **Project Structure:**
  - `public/`: Assets, OpenCV, icons, manifest/PWA icons.
  - `src/`: Components. `App.jsx` hosts the entire state machine: Camera -> Confirm/Adjust -> Cart -> Gallery/View.
  - `db.js`: IndexedDB wrapper for local gallery.
  - `aspect-ratio.js`: 3D projective plane aspect ratio recovery (Sturm/Triggs formulation), paper standard snapping (A-series, US Letter, US Legal, ID card, business card), and optimal un-distorted destination dimension computation.
  - `export.js`: Web Share API (`navigator.share`) export helper for JPEG images (Apple Photos) with download fallback and file download helper.
  - `filters.js`: Document enhancement filters (original, magic_color, lighten, shadow_removal, bw, grayscale) with thumbnail generation.
  - `geometry.js`: Geometric quad validation (`isReasonableQuad`), corner ordering (`orderPoints`), line intersection (`lineIntersection`), folded corner recovery (`recoverFoldedCorners`), and hand/object occlusion recovery (`recoverOccludedQuad`).
  - `stabilizer.js`: Real-time temporal smoothing (`CornerStabilizer`) with adaptive EMA filter for jitter-free 60 FPS camera tracking.
- **Workflow:**
  - Camera preview uses camera stream -> `requestAnimationFrame` -> direct canvas rendering and OpenCV corner detection (7x7 blur, CLAHE local contrast enhancement, two-pass Canny, multi-epsilon convex hull, folded corner & occlusion line intersection recovery, geometric quad validation) -> `CornerStabilizer` adaptive EMA smoothing -> polygon drawing on the same canvas.
  - Capture -> canvas-based OpenCV corner detection (with virtual corner recovery) and perspective warp using `computeWarpDimensions` for true aspect ratio recovery -> CamScanner preview with real-time filter switcher, press-and-hold compare, 90° rotation, and re-crop -> user confirmation -> Cart.
  - Gallery -> Browser IndexedDB storage (not persistent across cache clears).
  - Multi-page / Export -> `jspdf` generates PDF blobs locally; `export.js` handles JPEG image sharing to Apple Photos via Web Share API or individual page downloads.
- **PWA/Deployment:**
  - `vite-plugin-pwa` generates an auto-updating service worker that precaches the app shell but excludes the large local `opencv.js` binary.
  - HTTPS requirement: Essential for `getUserMedia`.

## Maintaining this file
- **Goal:** Keep developer-only architectural context, avoiding product/audience descriptions properly housed in `README.md`.
- **Update:** If adding new heavy dependencies or critical architecture changes, modify this section.
- **Scope:** Do not copy code, refer to source files.
