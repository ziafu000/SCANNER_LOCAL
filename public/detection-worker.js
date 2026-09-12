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
  const src = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  const edged = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const candidates = []

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0)
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
  cv.Canny(gray, edged, 75, 200)
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  cv.morphologyEx(edged, edged, cv.MORPH_CLOSE, kernel)
  kernel.delete()
  cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  const minArea = imageData.width * imageData.height * 0.05
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i)
    const area = cv.contourArea(cnt)
    if (area > minArea) candidates.push({ area, cnt: cnt.clone() })
    cnt.delete()
  }
  candidates.sort((a, b) => b.area - a.area)

  let points = null
  let fallbackPoints = null
  for (let i = 0; i < candidates.length; i++) {
    const { cnt } = candidates[i]
    const approx = new cv.Mat()
    cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true)
    if (approx.rows === 4) {
      const pts = []
      for (let j = 0; j < 4; j++) {
        pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
      }
      points = orderPoints(pts)
      approx.delete()
      break
    }
    if (i === 0) {
      const rect = cv.minAreaRect(cnt)
      const angle = rect.angle * Math.PI / 180
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const halfWidth = rect.size.width / 2
      const halfHeight = rect.size.height / 2
      fallbackPoints = orderPoints([
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ].map(p => ({
        x: rect.center.x + p.x * cosA - p.y * sinA,
        y: rect.center.y + p.x * sinA + p.y * cosA,
      })))
    }
    approx.delete()
  }

  candidates.forEach(({ cnt }) => cnt.delete())
  contours.delete()
  hierarchy.delete()
  edged.delete()
  gray.delete()
  src.delete()
  return points || fallbackPoints
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
