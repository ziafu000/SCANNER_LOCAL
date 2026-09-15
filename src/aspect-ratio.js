/**
 * Aspect Ratio Recovery & Paper Standard Snapping Engine
 *
 * Implements 3D projective plane aspect ratio recovery using Sturm/Triggs projective
 * geometry formulation to reconstruct the true physical width-to-height ratio of documents
 * captured at tilted/perspective angles.
 *
 * Automatically detects and snaps to international standard paper sizes (A-Series, US Letter,
 * US Legal, ID Cards, Business Cards) while preserving arbitrary custom dimensions (receipts, etc.).
 */

import { orderPoints } from './geometry.js'

/**
 * Standard paper aspect ratios (Long edge / Short edge >= 1.0).
 */
export const STANDARD_PAPER_RATIOS = [
  {
    id: 'a_series',
    name: 'A-Series (A4/A5/A3)',
    ratio: Math.SQRT2, // ~1.41421356
    tolerance: 0.08,   // ±8%
  },
  {
    id: 'us_letter',
    name: 'US Letter',
    ratio: 11 / 8.5,   // ~1.2941176
    tolerance: 0.05,   // ±5%
  },
  {
    id: 'us_legal',
    name: 'US Legal',
    ratio: 1.5455,
    altRatio: 14 / 8.5, // ~1.6470588
    tolerance: 0.05,   // ±5%
  },
  {
    id: 'id_card',
    name: 'ID Card / Thẻ ngân hàng',
    ratio: 85.60 / 53.98, // ~1.58577 (ISO/IEC 7810 ID-1)
    tolerance: 0.05,      // ±5%
  },
  {
    id: 'business_card',
    name: 'Card visit',
    ratio: 1.75,       // Standard 90x50 / 90x54 / 3.5x2 inch
    tolerance: 0.05,   // ±5%
  },
]

/**
 * Computes 3x3 matrix determinant for Cramer's rule linear solver.
 */
function det3(a, b, c, d, e, f, g, h, i) {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

/**
 * Estimates the true 3D plane aspect ratio (Width / Height) of a rectangular document
 * from 4 quadrilateral corner points in camera frame coordinates.
 *
 * Utilizes Sturm/Triggs perspective geometry constraints:
 * - Unprojects image corners into 3D sightline rays.
 * - Solves for projective plane depth coefficients using coplanarity and parallelism.
 * - Enforces orthogonality constraint on adjacent 3D edges to determine focal length.
 * - Computes true Euclidean 3D edge length ratio.
 *
 * @param {Array<{x: number, y: number}>} corners - 4 quadrilateral corner coordinates
 * @param {number} [frameWidth=1920] - Camera preview/image frame width
 * @param {number} [frameHeight=1440] - Camera preview/image frame height
 * @param {number} [cameraFocalLength=null] - Optional known camera focal length in pixels
 * @returns {number} Estimated true aspect ratio (Width / Height)
 */
export function computeTrueAspectRatio(corners, frameWidth = 1920, frameHeight = 1440, cameraFocalLength = null) {
  if (!corners || corners.length !== 4) return 1.0

  const pts = orderPoints(corners)
  const [p1, p2, p3, p4] = pts // [top-left, top-right, bottom-right, bottom-left]

  const w = frameWidth > 0 ? frameWidth : Math.max(pts[1].x, pts[2].x)
  const h = frameHeight > 0 ? frameHeight : Math.max(pts[2].y, pts[3].y)
  const cx = w / 2
  const cy = h / 2

  // 2D Euclidean edge lengths for fallback
  const top2D = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const bottom2D = Math.hypot(p3.x - p4.x, p3.y - p4.y)
  const left2D = Math.hypot(p4.x - p1.x, p4.y - p1.y)
  const right2D = Math.hypot(p3.x - p2.x, p3.y - p2.y)
  const avgW2D = (top2D + bottom2D) / 2
  const avgH2D = (left2D + right2D) / 2
  const fallbackRatio = avgH2D > 1e-6 ? avgW2D / avgH2D : 1.0

  // Solve [p2, p4, -p3] * [d2, d4, d3]^T = p1 in homogeneous coordinates
  // Matrix M = [[x2, x4, -x3], [y2, y4, -y3], [1, 1, -1]]
  const detM = det3(
    p2.x, p4.x, -p3.x,
    p2.y, p4.y, -p3.y,
    1, 1, -1
  )

  if (Math.abs(detM) < 1e-6) {
    return fallbackRatio
  }

  const det2 = det3(
    p1.x, p4.x, -p3.x,
    p1.y, p4.y, -p3.y,
    1, 1, -1
  )

  const det4 = det3(
    p2.x, p1.x, -p3.x,
    p2.y, p1.y, -p3.y,
    1, 1, -1
  )

  const d1 = 1.0
  const d2 = det2 / detM
  const d4 = det4 / detM

  // Depths must be positive (in front of camera)
  if (d2 <= 0 || d4 <= 0) {
    return fallbackRatio
  }

  // Camera focal length nominal estimate (~70 deg FOV standard mobile camera)
  const fNominal = cameraFocalLength && cameraFocalLength > 0
    ? cameraFocalLength
    : Math.max(w, h) * 0.82

  let f = fNominal

  // Centered coordinates
  const u1x = p1.x - cx, u1y = p1.y - cy
  const u2x = p2.x - cx, u2y = p2.y - cy
  const u4x = p4.x - cx, u4y = p4.y - cy

  // Unprojected edge vector components: E_top = d2*v2 - d1*v1, E_left = d4*v4 - d1*v1
  const ex_x = d2 * u2x - d1 * u1x
  const ex_y = d2 * u2y - d1 * u1y
  const ey_x = d4 * u4x - d1 * u1x
  const ey_y = d4 * u4y - d1 * u1y

  // Orthogonality constraint: E_top . E_left = 0 in 3D
  // (ex_x * ey_x + ex_y * ey_y) / f^2 + (d2 - 1) * (d4 - 1) = 0
  const A = ex_x * ey_x + ex_y * ey_y
  const B = (d2 - d1) * (d4 - d1)

  if (Math.abs(B) > 1e-7 && -A / B > 0) {
    const fEst = Math.sqrt(-A / B)
    if (fEst >= 0.25 * fNominal && fEst <= 3.5 * fNominal) {
      f = fEst
    }
  }

  // 3D Corner coordinates (scaled by d1)
  const P1 = { x: (u1x / f) * d1, y: (u1y / f) * d1, z: d1 }
  const P2 = { x: (u2x / f) * d2, y: (u2y / f) * d2, z: d2 }
  const P4 = { x: (u4x / f) * d4, y: (u4y / f) * d4, z: d4 }

  const W3D = Math.hypot(P2.x - P1.x, P2.y - P1.y, P2.z - P1.z)
  const H3D = Math.hypot(P4.x - P1.x, P4.y - P1.y, P4.z - P1.z)

  if (W3D > 1e-6 && H3D > 1e-6) {
    const ratio = W3D / H3D
    if (Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 5.0) {
      return ratio
    }
  }

  return fallbackRatio
}

/**
 * Snaps a computed aspect ratio to international standard paper sizes if within tolerance.
 *
 * @param {number} aspectRatio - Document aspect ratio (Width / Height)
 * @returns {{
 *   ratio: number,
 *   isSnapped: boolean,
 *   standard: string,
 *   name: string,
 *   originalRatio: number
 * }} Snapping result object
 */
export function snapToStandardPaper(aspectRatio) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return {
      ratio: 1.0,
      isSnapped: false,
      standard: 'custom',
      name: 'Tự do',
      originalRatio: aspectRatio,
    }
  }

  const isPortrait = aspectRatio < 1.0
  const normalized = isPortrait ? (1 / aspectRatio) : aspectRatio

  let bestMatch = null
  let minDiff = Infinity

  for (const std of STANDARD_PAPER_RATIOS) {
    const diffPrimary = Math.abs(normalized - std.ratio) / std.ratio
    let diff = diffPrimary
    let targetRatio = std.ratio

    if (std.altRatio) {
      const diffAlt = Math.abs(normalized - std.altRatio) / std.altRatio
      if (diffAlt < diff) {
        diff = diffAlt
        targetRatio = std.altRatio
      }
    }

    if (diff <= std.tolerance && diff < minDiff) {
      minDiff = diff
      bestMatch = {
        std,
        diff,
        targetRatio,
      }
    }
  }

  if (bestMatch) {
    const snapped = isPortrait ? (1 / bestMatch.targetRatio) : bestMatch.targetRatio
    return {
      ratio: snapped,
      isSnapped: true,
      standard: bestMatch.std.id,
      name: bestMatch.std.name,
      originalRatio: aspectRatio,
    }
  }

  return {
    ratio: aspectRatio,
    isSnapped: false,
    standard: 'custom',
    name: 'Tự do',
    originalRatio: aspectRatio,
  }
}

/**
 * Computes optimal un-distorted destination canvas dimensions (Width x Height)
 * by applying 3D true aspect ratio recovery and paper standard snapping.
 *
 * @param {Array<{x: number, y: number}>} corners - 4 quadrilateral corner coordinates
 * @param {number} originalWidth - Source image width in pixels
 * @param {number} originalHeight - Source image height in pixels
 * @param {object} [options] - Additional options
 * @returns {{
 *   width: number,
 *   height: number,
 *   aspectRatio: number,
 *   rawAspectRatio: number,
 *   isSnapped: boolean,
 *   standard: string,
 *   name: string
 * }} Destination dimensions and metadata
 */
export function computeWarpDimensions(corners, originalWidth, originalHeight, options = {}) {
  const pts = orderPoints(corners)
  const rawRatio = computeTrueAspectRatio(pts, originalWidth, originalHeight, options.focalLength)
  const snapInfo = snapToStandardPaper(rawRatio)
  const targetRatio = snapInfo.ratio

  // Calculate approximate bounds in source pixel space
  const top = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
  const bottom = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y)
  const left = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y)
  const right = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)

  const imgW = Math.max(top, bottom)
  const imgH = Math.max(left, right)

  let dstW, dstH
  if (targetRatio >= 1.0) {
    // Landscape or square
    dstW = Math.max(imgW, imgH * targetRatio)
    dstH = dstW / targetRatio
  } else {
    // Portrait
    dstH = Math.max(imgH, imgW / targetRatio)
    dstW = dstH * targetRatio
  }

  let finalW = Math.round(dstW)
  let finalH = Math.round(dstH)

  // Clamp to sane image bounds
  finalW = Math.max(16, finalW)
  finalH = Math.max(16, finalH)

  return {
    width: finalW,
    height: finalH,
    aspectRatio: targetRatio,
    rawAspectRatio: rawRatio,
    isSnapped: snapInfo.isSnapped,
    standard: snapInfo.standard,
    name: snapInfo.name,
  }
}
