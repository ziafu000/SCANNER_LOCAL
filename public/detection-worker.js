let ready = false
let pending = null

function orderPoints(pts) {
  const sumSorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const tl = sumSorted[0]
  const br = sumSorted[3]
  const remaining = [sumSorted[1], sumSorted[2]]
  remaining.sort((a, b) => (b.x - b.y) - (a.x - a.y))
  return [tl, remaining[0], br, remaining[1]]
}

function isValidQuad(points, totalArea) {
  if (!points || points.length !== 4) return false

  // Distinct corners check
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 15) return false
    }
  }

  // Shoelace area check: must be 15% to 85% of totalArea
  let signedArea = 0
  for (let i = 0; i < 4; i++) {
    const next = points[(i + 1) % 4]
    signedArea += points[i].x * next.y - next.x * points[i].y
  }
  const area = Math.abs(signedArea) * 0.5
  if (area < 0.15 * totalArea || area > 0.85 * totalArea) return false

  // Edge lengths and Aspect Ratio check
  const edgeLens = []
  for (let i = 0; i < 4; i++) {
    const next = points[(i + 1) % 4]
    edgeLens.push(Math.hypot(next.x - points[i].x, next.y - points[i].y))
  }
  const top = edgeLens[0], right = edgeLens[1], bottom = edgeLens[2], left = edgeLens[3]
  const avgW = (top + bottom) / 2
  const avgH = (left + right) / 2
  if (avgW <= 0 || avgH <= 0) return false
  const ratio = Math.max(avgW, avgH) / Math.min(avgW, avgH)
  // Document aspect ratio must be between 1.15 and 1.85
  if (ratio < 1.15 || ratio > 1.85) return false

  // Strict convexity and interior angle checks (65 to 115 deg)
  let positive = 0, negative = 0
  for (let i = 0; i < 4; i++) {
    const p0 = points[(i + 3) % 4]
    const p1 = points[i]
    const p2 = points[(i + 1) % 4]
    const v1x = p0.x - p1.x, v1y = p0.y - p1.y
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y
    const cross = v1x * v2y - v1y * v2x
    if (cross > 0) positive++
    if (cross < 0) negative++

    const dot = v1x * v2x + v1y * v2y
    const mag1 = Math.hypot(v1x, v1y)
    const mag2 = Math.hypot(v2x, v2y)
    if (mag1 === 0 || mag2 === 0) return false
    const cosA = Math.max(-1, Math.min(1, dot / (mag1 * mag2)))
    const angleDeg = Math.acos(cosA) * (180 / Math.PI)
    if (angleDeg < 65 || angleDeg > 115) return false
  }
  if (positive !== 4 && negative !== 4) return false
  return true
}

function findOptimalCorners(imageData) {
  const totalArea = imageData.width * imageData.height
  const width = imageData.width
  const height = imageData.height
  let src = null
  let gray = null
  let edged = null
  let contours = null
  let hierarchy = null
  let kernel = null
  const candidates = []

  try {
    src = cv.matFromImageData(imageData)
    gray = new cv.Mat()
    edged = new cv.Mat()
    contours = new cv.MatVector()
    hierarchy = new cv.Mat()
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(gray, edged, 65, 185)
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
    cv.morphologyEx(edged, edged, cv.MORPH_CLOSE, kernel)
    kernel.delete()
    kernel = null
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    for (let i = 0; i < contours.size(); i++) {
      let cnt = null
      try {
        cnt = contours.get(i)
        const area = cv.contourArea(cnt)
        if (area >= 0.15 * totalArea && area <= 0.85 * totalArea) {
          const rect = cv.boundingRect(cnt)
          if (rect.x <= 3 || rect.y <= 3 ||
              rect.x + rect.width >= width - 3 ||
              rect.y + rect.height >= height - 3) {
            continue
          }
          candidates.push({ area, cnt: cnt.clone() })
        }
      } finally {
        cnt?.delete()
      }
    }

    candidates.sort((a, b) => b.area - a.area)
    for (const candidate of candidates) {
      if (!cv.isContourConvex(candidate.cnt)) continue
      let hull = null
      try {
        hull = new cv.Mat()
        cv.convexHull(candidate.cnt, hull, false, true)
        const peri = cv.arcLength(hull, true)
        const hullArea = cv.contourArea(hull)
        for (const epsRatio of [0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06]) {
          let approx = null
          try {
            approx = new cv.Mat()
            cv.approxPolyDP(hull, approx, epsRatio * peri, true)
            if (approx.rows === 4 && cv.isContourConvex(approx) && hullArea > 0 && cv.contourArea(approx) / hullArea > 0.65) {
              const points = []
              for (let j = 0; j < 4; j++) {
                points.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
              }
              const ordered = orderPoints(points)
              if (isValidQuad(ordered, totalArea)) return ordered
            }
          } finally {
            approx?.delete()
          }
        }

        const n = hull.rows
        let tl, tr, br, bl
        let minSum = Infinity, maxSum = -Infinity, maxDiff = -Infinity, minDiff = Infinity
        for (let j = 0; j < n; j++) {
          const x = hull.data32S[j * 2]
          const y = hull.data32S[j * 2 + 1]
          const s = x + y, d = x - y
          if (s < minSum) { minSum = s; tl = { x, y } }
          if (s > maxSum) { maxSum = s; br = { x, y } }
          if (d > maxDiff) { maxDiff = d; tr = { x, y } }
          if (d < minDiff) { minDiff = d; bl = { x, y } }
        }
        if (tl && tr && br && bl) {
          const extremes = orderPoints([tl, tr, br, bl])
          if (isValidQuad(extremes, totalArea)) return extremes
        }
      } finally {
        hull?.delete()
      }
    }
    return null
  } finally {
    candidates.forEach(({ cnt }) => cnt.delete())
    kernel?.delete()
    hierarchy?.delete()
    contours?.delete()
    edged?.delete()
    gray?.delete()
    src?.delete()
  }
}

function detect(message) {
  const { id, width, height, imageData } = message
  try {
    const points = findOptimalCorners(imageData)
    postMessage({ id, width, height, points })
  } catch {
    postMessage({ id, width, height, points: null })
  }
}

onmessage = ({ data }) => {
  if (ready) detect(data)
  else pending = data
}

importScripts('./opencv.js')
const markReady = () => {
  ready = true
  if (pending) {
    detect(pending)
    pending = null
  }
}
if (cv.Mat) markReady()
else cv.onRuntimeInitialized = markReady
