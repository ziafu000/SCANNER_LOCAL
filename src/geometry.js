/**
 * Geometry helper utilities for document quad detection & validation.
 */

export function orderPoints(pts) {
  const sumSorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const tl = sumSorted[0]
  const br = sumSorted[3]
  const remaining = [sumSorted[1], sumSorted[2]]
  remaining.sort((a, b) => (b.x - b.y) - (a.x - a.y))
  return [tl, remaining[0], br, remaining[1]]
}

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
