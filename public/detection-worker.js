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

function findOptimalCorners(imageData) {
  const totalArea = imageData.width * imageData.height
  const src = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  const edged = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const candidates = []

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0)
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
  cv.Canny(gray, edged, 40, 140)
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  cv.morphologyEx(edged, edged, cv.MORPH_CLOSE, kernel)
  kernel.delete()
  cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i)
    const area = cv.contourArea(cnt)
    if (area > 0.06 * totalArea && area < 0.98 * totalArea) {
      candidates.push({ area, cnt: cnt.clone() })
    }
    cnt.delete()
  }
  candidates.sort((a, b) => b.area - a.area)

  let points = null

  for (let i = 0; i < candidates.length; i++) {
    // Prevent snapping to inner illustrations: skip if candidate is much smaller than largest
    if (i > 0 && candidates[i].area < 0.45 * candidates[0].area) break

    const { cnt } = candidates[i]

    // Compute convex hull first to smooth noisy contour edges
    const hull = new cv.Mat()
    cv.convexHull(cnt, hull, false, true)

    // Multi-epsilon sweep on the convex hull
    let found = null
    const peri = cv.arcLength(hull, true)
    for (const epsRatio of [0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06]) {
      const approx = new cv.Mat()
      cv.approxPolyDP(hull, approx, epsRatio * peri, true)
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const approxArea = cv.contourArea(approx)
        const hullArea = cv.contourArea(hull)
        if (hullArea > 0 && approxArea / hullArea > 0.65) {
          const pts = []
          for (let j = 0; j < 4; j++) {
            pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
          }
          found = orderPoints(pts)
          approx.delete()
          break
        }
      }
      approx.delete()
    }

    if (found) {
      hull.delete()
      points = found
      // If the largest candidate yields a valid quad, use it and stop
      break
    }

    // Extreme-diagonal fallback: extract 4 extreme hull vertices (never overshoots)
    if (i === 0 && !found) {
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
        points = orderPoints([tl, tr, br, bl])
      }
    }

    hull.delete()
    if (points) break
  }

  candidates.forEach(({ cnt }) => cnt.delete())
  contours.delete()
  hierarchy.delete()
  edged.delete()
  gray.delete()
  src.delete()

  return points
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
