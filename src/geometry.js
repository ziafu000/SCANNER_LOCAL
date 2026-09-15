/**
 * Geometry helper utilities for document quad detection & validation.
 */

/**
 * Orders 4 quadrilateral points into [top-left, top-right, bottom-right, bottom-left].
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {Array<{x: number, y: number}>}
 */
export function orderPoints(pts) {
  const sumSorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const tl = sumSorted[0]
  const br = sumSorted[3]
  const remaining = [sumSorted[1], sumSorted[2]]
  remaining.sort((a, b) => (b.x - b.y) - (a.x - a.y))
  return [tl, remaining[0], br, remaining[1]]
}

/**
 * Validates whether 4 points form a plausible document quadrilateral:
 * - Minimum edge length >= 15px
 * - Parallel edge ratio >= 0.55 for both width and height
 * - Document aspect ratio between 0.3 and 3.5
 * - Interior angles between ~65° and ~115° (|cos| <= 0.42)
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {boolean}
 */
export function isReasonableQuad(pts) {
  if (!pts || pts.length !== 4) return false
  const [tl, tr, br, bl] = pts
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const right = Math.hypot(br.x - tr.x, br.y - tr.y)
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y)

  if (top < 15 || bottom < 15 || left < 15 || right < 15) return false

  const widthRatio = Math.min(top, bottom) / Math.max(top, bottom)
  const heightRatio = Math.min(left, right) / Math.max(left, right)
  if (widthRatio < 0.55 || heightRatio < 0.55) return false

  const avgWidth = (top + bottom) / 2
  const avgHeight = (left + right) / 2
  const ar = avgWidth / avgHeight
  if (ar < 0.3 || ar > 3.5) return false

  // 4 interior angles check: between ~65° and 115° (|cos| <= 0.42)
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4]
    const curr = pts[i]
    const next = pts[(i + 1) % 4]

    const v1x = prev.x - curr.x
    const v1y = prev.y - curr.y
    const v2x = next.x - curr.x
    const v2y = next.y - curr.y

    const len1 = Math.hypot(v1x, v1y)
    const len2 = Math.hypot(v2x, v2y)
    if (len1 < 1e-6 || len2 < 1e-6) return false

    const cosAngle = (v1x * v2x + v1y * v2y) / (len1 * len2)
    if (Math.abs(cosAngle) > 0.42) return false
  }

  return true
}

/**
 * Calculates intersection of infinite line through (p1, p2) and infinite line through (p3, p4).
 * Returns {x, y} or null if lines are parallel.
 *
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @param {{x: number, y: number}} p3
 * @param {{x: number, y: number}} p4
 * @returns {{x: number, y: number} | null}
 */
export function lineIntersection(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(d) < 1e-6) return null
  const cross1 = p1.x * p2.y - p1.y * p2.x
  const cross2 = p3.x * p4.y - p3.y * p4.x
  const x = (cross1 * (p3.x - p4.x) - (p1.x - p2.x) * cross2) / d
  const y = (cross1 * (p3.y - p4.y) - (p1.y - p2.y) * cross2) / d
  return { x, y }
}

/**
 * Calculates polygon area using the Shoelace formula.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {number}
 */
export function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Recovers 4 geometric document corners from a polygon that may have folded/cut corners.
 * Uses Line Intersection of the primary boundary edges to recover virtual corners.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {Array<{x: number, y: number}> | null} Ordered [tl, tr, br, bl] quad or null
 */
export function recoverFoldedCorners(pts) {
  if (!pts || pts.length < 4) return null

  // If already 4 points: check validity directly
  if (pts.length === 4) {
    const ordered = orderPoints(pts)
    return isReasonableQuad(ordered) ? ordered : null
  }

  // Handle 5-vertex polygon (single folded corner or crease)
  if (pts.length === 5) {
    const n = 5
    const originalArea = polygonArea(pts)
    const candidates = []

    for (let k = 0; k < n; k++) {
      const prevIdx = (k - 1 + n) % n
      const nextIdx = (k + 1) % n
      const nextNextIdx = (k + 2) % n

      // Edge before fold: prevIdx -> k
      // Edge after fold: nextIdx -> nextNextIdx
      const vPrev = pts[prevIdx]
      const vCurr = pts[k]
      const vNext = pts[nextIdx]
      const vNextNext = pts[nextNextIdx]

      // Angle check between edge before and edge after: must be roughly perpendicular
      const v1x = vCurr.x - vPrev.x
      const v1y = vCurr.y - vPrev.y
      const v2x = vNextNext.x - vNext.x
      const v2y = vNextNext.y - vNext.y
      const l1 = Math.hypot(v1x, v1y)
      const l2 = Math.hypot(v2x, v2y)
      if (l1 < 1e-6 || l2 < 1e-6) continue

      const cosAngle = (v1x * v2x + v1y * v2y) / (l1 * l2)
      // Expect near 90 deg between adjacent document edges (|cos| <= 0.45)
      if (Math.abs(cosAngle) > 0.45) continue

      // Compute intersection of the two edges
      const inter = lineIntersection(vPrev, vCurr, vNext, vNextNext)
      if (!inter) continue

      // Remaining vertices that are not part of the fold edge
      const otherVertices = []
      for (let j = 0; j < n; j++) {
        if (j !== k && j !== nextIdx) {
          otherVertices.push(pts[j])
        }
      }

      const quad4 = [...otherVertices, inter]
      const ordered = orderPoints(quad4)
      if (!isReasonableQuad(ordered)) continue

      const quadArea = polygonArea(ordered)
      // Recovered quad should encompass the folded paper (area >= 5-gon area * 0.95)
      if (quadArea < originalArea * 0.95) continue

      candidates.push({
        quad: ordered,
        orthoScore: Math.abs(cosAngle),
        areaDiff: quadArea - originalArea,
        quadArea
      })
    }

    if (candidates.length > 0) {
      // Pick candidate with best orthogonal score and reasonable area
      candidates.sort((a, b) => a.orthoScore - b.orthoScore)
      return candidates[0].quad
    }
  }

  // Handle 6-vertex polygon (e.g. 2 folded corners)
  if (pts.length === 6) {
    const originalArea = polygonArea(pts)
    const n = 6
    // Identify 4 longest non-parallel edge segments
    const edges = []
    for (let i = 0; i < n; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n]
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      edges.push({ i, p1, p2, len })
    }
    const longest = [...edges].sort((a, b) => b.len - a.len).slice(0, 4)
    longest.sort((a, b) => a.i - b.i)
    if (longest.length === 4) {
      const corners = []
      for (let i = 0; i < 4; i++) {
        const e1 = longest[i]
        const e2 = longest[(i + 1) % 4]
        const pt = lineIntersection(e1.p1, e1.p2, e2.p1, e2.p2)
        if (pt) corners.push(pt)
      }
      if (corners.length === 4) {
        const ordered = orderPoints(corners)
        if (isReasonableQuad(ordered) && polygonArea(ordered) >= originalArea * 0.9) {
          return ordered
        }
      }
    }
  }

  return null
}

/**
 * Recovers 4 geometric document corners from an occluded polygon (5 to 12 vertices)
 * where edges are partially blocked by fingers, pens, or background overlaps.
 * Uses orientation clustering and primary line fitting to intersect the 4 boundary edges.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {Array<{x: number, y: number}> | null} Ordered [tl, tr, br, bl] quad or null
 */
export function recoverOccludedQuad(pts) {
  if (!pts || pts.length < 5 || pts.length > 12) return null
  const n = pts.length
  const origArea = polygonArea(pts)

  // Extract all edge segments with length and direction angle
  const edges = []
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 5) continue
    let angle = Math.atan2(dy, dx)
    if (angle < 0) angle += Math.PI // normalize to [0, PI)
    edges.push({ i, p1, p2, len, angle, dx, dy })
  }

  if (edges.length < 4) return null

  // Sort edges by length to find the primary orientation
  const sortedByLen = [...edges].sort((a, b) => b.len - a.len)
  const primary = sortedByLen[0]
  const primaryAngle = primary.angle
  const perpAngle = (primaryAngle + Math.PI / 2) % Math.PI

  function angleDiff(a1, a2) {
    let d = Math.abs(a1 - a2) % Math.PI
    if (d > Math.PI / 2) d = Math.PI - d
    return d
  }

  // Classify edges into parallel vs perpendicular relative to primary document axis
  const group1 = [] // parallel to primary (e.g. top / bottom)
  const group2 = [] // perpendicular to primary (e.g. left / right)

  for (const e of edges) {
    const d1 = angleDiff(e.angle, primaryAngle)
    const d2 = angleDiff(e.angle, perpAngle)
    if (d1 <= d2 && d1 < 0.45) {
      group1.push(e)
    } else if (d2 < d1 && d2 < 0.45) {
      group2.push(e)
    }
  }

  if (group1.length < 2 || group2.length < 2) return null

  group1.sort((a, b) => b.len - a.len)
  group2.sort((a, b) => b.len - a.len)

  // Pick two opposite sides in group1
  const e1a = group1[0]
  let e1b = null
  for (let j = 1; j < group1.length; j++) {
    const midA = { x: (e1a.p1.x + e1a.p2.x) / 2, y: (e1a.p1.y + e1a.p2.y) / 2 }
    const midB = { x: (group1[j].p1.x + group1[j].p2.x) / 2, y: (group1[j].p1.y + group1[j].p2.y) / 2 }
    const dist = Math.hypot(midA.x - midB.x, midA.y - midB.y)
    if (dist > 25) {
      e1b = group1[j]
      break
    }
  }

  // Pick two opposite sides in group2
  const e2a = group2[0]
  let e2b = null
  for (let j = 1; j < group2.length; j++) {
    const midA = { x: (e2a.p1.x + e2a.p2.x) / 2, y: (e2a.p1.y + e2a.p2.y) / 2 }
    const midB = { x: (group2[j].p1.x + group2[j].p2.x) / 2, y: (group2[j].p1.y + group2[j].p2.y) / 2 }
    const dist = Math.hypot(midA.x - midB.x, midA.y - midB.y)
    if (dist > 25) {
      e2b = group2[j]
      break
    }
  }

  if (!e1b || !e2b) return null

  // Compute 4 corner intersections
  const c1 = lineIntersection(e1a.p1, e1a.p2, e2a.p1, e2a.p2)
  const c2 = lineIntersection(e1a.p1, e1a.p2, e2b.p1, e2b.p2)
  const c3 = lineIntersection(e1b.p1, e1b.p2, e2a.p1, e2a.p2)
  const c4 = lineIntersection(e1b.p1, e1b.p2, e2b.p1, e2b.p2)

  if (!c1 || !c2 || !c3 || !c4) return null

  const quad = orderPoints([c1, c2, c3, c4])
  if (!isReasonableQuad(quad)) return null

  const qArea = polygonArea(quad)
  if (qArea < origArea * 0.80 || qArea > origArea * 1.5) return null

  return quad
}

