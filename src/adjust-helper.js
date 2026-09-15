/**
 * Safe coordinate extraction and geometric constraint helpers for touch / pointer interaction
 * on iOS Safari and modern mobile browsers.
 */

/**
 * Extracts clientX and clientY from a PointerEvent, MouseEvent, TouchEvent, or React SyntheticEvent.
 * Returns null if coordinates cannot be safely extracted or are non-finite / NaN.
 *
 * @param {Event|React.SyntheticEvent|Object} e
 * @returns {{ clientX: number, clientY: number } | null}
 */
export function extractClientCoords(e) {
  if (!e) return null

  // 1. Check touches (TouchEvent on touchstart / touchmove)
  if (e.touches && e.touches.length > 0) {
    const t = e.touches[0]
    if (t && Number.isFinite(t.clientX) && Number.isFinite(t.clientY)) {
      return { clientX: t.clientX, clientY: t.clientY }
    }
  }

  // 2. Check changedTouches (TouchEvent on touchend / touchcancel)
  if (e.changedTouches && e.changedTouches.length > 0) {
    const t = e.changedTouches[0]
    if (t && Number.isFinite(t.clientX) && Number.isFinite(t.clientY)) {
      return { clientX: t.clientX, clientY: t.clientY }
    }
  }

  // 3. PointerEvent / MouseEvent
  if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
    return { clientX: e.clientX, clientY: e.clientY }
  }

  return null
}

/**
 * Calculates clamped coordinates scaled to natural image dimensions.
 * Clamps normalized position between [0, 1] relative to the element's bounding rect.
 * Returns null if any input is invalid, non-finite, or bounding dimensions are <= 0.
 *
 * @param {{ clientX: number, clientY: number }} coords
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ width: number, height: number }} imageSize
 * @returns {{ x: number, y: number } | null}
 */
export function calculateClampedPoint(coords, rect, imageSize) {
  if (!coords || !rect || !imageSize) return null

  const { clientX, clientY } = coords
  const { left, top, width: rectW, height: rectH } = rect
  const { width: imgW, height: imgH } = imageSize

  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(rectW) ||
    !Number.isFinite(rectH) ||
    !Number.isFinite(imgW) ||
    !Number.isFinite(imgH) ||
    rectW <= 0 ||
    rectH <= 0 ||
    imgW <= 0 ||
    imgH <= 0
  ) {
    return null
  }

  // Normalize between 0 and 1
  const normX = Math.max(0, Math.min(1, (clientX - left) / rectW))
  const normY = Math.max(0, Math.min(1, (clientY - top) / rectH))

  if (!Number.isFinite(normX) || !Number.isFinite(normY)) {
    return null
  }

  return {
    x: normX * imgW,
    y: normY * imgH
  }
}

/**
 * Updates a point in the 4-point corner array safely.
 * Returns a new array if valid, or original array if invalid.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} index
 * @param {{ x: number, y: number }} newPoint
 * @returns {Array<{x: number, y: number}>}
 */
export function updateCornerPoint(points, index, newPoint) {
  if (!Array.isArray(points) || index < 0 || index >= points.length) {
    return points
  }
  if (!newPoint || !Number.isFinite(newPoint.x) || !Number.isFinite(newPoint.y)) {
    return points
  }

  return points.map((p, i) => (i === index ? { x: newPoint.x, y: newPoint.y } : p))
}

/**
 * Builds SVG polygon points string in percentage format ("x1%,y1% x2%,y2% ...")
 * or pixel format if dimensions are provided.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {{ width: number, height: number }} imageSize
 * @returns {string}
 */
export function getSvgPolygonPoints(points, imageSize) {
  if (!Array.isArray(points) || points.length !== 4 || !imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    return ''
  }

  for (const pt of points) {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return ''
    }
  }

  return points.map(p => `${p.x},${p.y}`).join(' ')
}
