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

function isValidQuad(points) {
  if (new Set(points.map(({ x, y }) => `${x},${y}`)).size !== 4) return false
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0)
  return Math.abs(area) > 1
}

function findOptimalCorners(imageData) {
  const totalArea = imageData.width * imageData.height
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
    cv.Canny(gray, edged, 40, 140)
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
        if (area > 0.06 * totalArea && area < 0.98 * totalArea) {
          candidates.push({ area, cnt: cnt.clone() })
        }
      } finally {
        cnt?.delete()
      }
    }

    const candidate = candidates.sort((a, b) => b.area - a.area)[0]
    if (!candidate) return null

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
            return orderPoints(points)
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
        if (isValidQuad(extremes)) return extremes
      }
      return null
    } finally {
      hull?.delete()
    }
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
