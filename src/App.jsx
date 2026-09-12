import { useEffect, useRef, useState } from 'react'
import JScanify from 'jscanify/client'
import { jsPDF } from 'jspdf'
import {
  Camera,
  Layers,
  FileText,
  ChevronLeft,
  RotateCcw,
  Check,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  X,
  Plus,
  Sliders,
  Sparkles,
  RefreshCw,
  FolderOpen
} from 'lucide-react'
import { listScans, putScan, removeScan } from './db'

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
const blobFrom = (canvas) => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
const urlOf = blob => URL.createObjectURL(blob)
const label = (time) => new Date(time).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
const defaultDocName = () => `Tài liệu ${label(Date.now())}`

function canvasFilter(source, kind) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d')
  c.width = source.width; c.height = source.height; ctx.drawImage(source, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data
  for (let i = 0; i < p.length; i += 4) {
    const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]
    if (kind === 'bw') {
      const bw = v > 165 ? 255 : 0
      p[i] = p[i + 1] = p[i + 2] = bw
    } else if (kind === 'gray') {
      p[i] = p[i + 1] = p[i + 2] = v
    } else {
      // Color: lighten paper, boost contrast slightly
      p[i] = Math.min(255, p[i] * 1.08 + 10)
      p[i + 1] = Math.min(255, p[i + 1] * 1.08 + 10)
      p[i + 2] = Math.min(255, p[i + 2] * 1.03 + 6)
    }
  }
  ctx.putImageData(d, 0, 0)
  return c
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = url
  })
}

function fitPoints(w, h) {
  return [
    { x: w * 0.08, y: h * 0.08 },
    { x: w * 0.92, y: h * 0.08 },
    { x: w * 0.92, y: h * 0.92 },
    { x: w * 0.08, y: h * 0.92 },
  ]
}

function orderPoints(pts) {
  const sumSorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const tl = sumSorted[0]
  const br = sumSorted[3]
  const remaining = [sumSorted[1], sumSorted[2]]
  remaining.sort((a, b) => (b.x - b.y) - (a.x - a.y))
  return [tl, remaining[0], br, remaining[1]]
}

function findOptimalCorners(canvas) {
  if (!window.cv) return null
  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0)
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
  const edged = new cv.Mat()
  cv.Canny(gray, edged, 75, 200)

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
  cv.morphologyEx(edged, edged, cv.MORPH_CLOSE, kernel)
  kernel.delete()

  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  let candidates = []
  const minArea = canvas.width * canvas.height * 0.05

  for (let i = 0; i < contours.size(); ++i) {
    const cnt = contours.get(i)
    const area = cv.contourArea(cnt)
    if (area > minArea) {
      candidates.push({ area, cnt: cnt.clone() })
    }
    cnt.delete()
  }

  candidates.sort((a, b) => b.area - a.area)

  let points = null
  let fallbackPoints = null

  for (let i = 0; i < candidates.length; i++) {
    const { cnt } = candidates[i]
    const peri = cv.arcLength(cnt, true)
    const approx = new cv.Mat()
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true)

    if (approx.rows === 4) {
      const pts = []
      for (let j = 0; j < 4; j++) {
        pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
      }
      points = orderPoints(pts)
      approx.delete()
      break
    } else if (i === 0) {
      const pts = []
      const rect = cv.minAreaRect(cnt)
      let usedBoxPoints = false
      if (cv.boxPoints) {
        try {
          const box = new cv.Mat()
          cv.boxPoints(rect, box)
          for (let j = 0; j < 4; j++) {
            pts.push({ x: box.data32F[j * 2], y: box.data32F[j * 2 + 1] })
          }
          box.delete()
          usedBoxPoints = true
        } catch (e) {
          console.warn('cv.boxPoints failed, falling back to manual calculation', e)
        }
      }
      
      if (!usedBoxPoints) {
        const cx = rect.center.x, cy = rect.center.y
        const w = rect.size.width / 2, h = rect.size.height / 2
        const angle = (rect.angle * Math.PI) / 180.0
        const cosA = Math.cos(angle), sinA = Math.sin(angle)
        const offsets = [
          { x: -w, y: -h },
          { x: w, y: -h },
          { x: w, y: h },
          { x: -w, y: h }
        ]
        for (const p of offsets) {
          pts.push({
            x: cx + p.x * cosA - p.y * sinA,
            y: cy + p.x * sinA + p.y * cosA
          })
        }
      }
      fallbackPoints = orderPoints(pts)
    }
    approx.delete()
  }

  if (!points && fallbackPoints) {
    points = fallbackPoints
  }

  for (const c of candidates) {
    c.cnt.delete()
  }

  contours.delete()
  hierarchy.delete()
  edged.delete()
  gray.delete()
  src.delete()

  return points
}

function customExtract(srcCanvas, pts) {
  const cv = window.cv
  const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y)
  const w = Math.round(Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2])))
  const h = Math.round(Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2])))
  
  const src = cv.imread(srcCanvas)
  const dst = new cv.Mat()
  const dsize = new cv.Size(w, h)
  
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    pts[0].x, pts[0].y, pts[1].x, pts[1].y,
    pts[2].x, pts[2].y, pts[3].x, pts[3].y
  ])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, w, 0, w, h, 0, h
  ])
  
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar())
  
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  cv.imshow(out, dst)
  
  src.delete(); dst.delete(); srcTri.delete(); dstTri.delete(); M.delete()
  return out
}

export default function App() {
  const video = useRef(), live = useRef(), stream = useRef(), scan = useRef(), frame = useRef(0)
  // Offscreen canvas for downscaled OpenCV detection (~360px wide)
  const offscreen = useRef(null)
  // Flag: true while an async detection pass is running (prevents re-entrancy)
  const isDetecting = useRef(false)
  // Timestamp of the last detection kick-off (ms) — used for throttling
  const lastDetectTime = useRef(0)
  const activeCornersRef = useRef(null) // last green-box corners seen in the live preview (overlay coords)
  const [screen, setScreen] = useState('camera')
  const [status, setStatus] = useState('Đang tải bộ quét…')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [pages, setPages] = useState([])
  const pagesRef = useRef([])
  const [filter, setFilter] = useState('color')
  const [gallery, setGallery] = useState([])
  const [drag, setDrag] = useState(null)
  // Document name for the current cart session
  const [docName, setDocName] = useState(defaultDocName)
  // Toast message
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  // For gallery view mode (read-only pages)
  const [viewRecord, setViewRecord] = useState(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const [viewedPages, setViewedPages] = useState([])
  // Capture confirmation: pending page waiting for user to confirm/retake
  const [pendingPage, setPendingPage] = useState(null) // { id, blob, url }
  // Fullscreen lightbox: URL of image to show, or null
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    const nextPages = viewRecord?.pages.map((blob, i) => ({
      id: `${viewRecord.id}-${i}`,
      blob,
      url: urlOf(blob),
    })) ?? []
    setViewedPages(nextPages)
    return () => nextPages.forEach(page => URL.revokeObjectURL(page.url))
  }, [viewRecord])

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => () => {
    pagesRef.current.forEach(page => URL.revokeObjectURL(page.url))
  }, [])

  useEffect(() => {
    const rawUrl = draft?.raw
    return () => {
      if (rawUrl) URL.revokeObjectURL(rawUrl)
    }
  }, [draft?.raw])

  const stopped = () => { cancelAnimationFrame(frame.current); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  const refreshGallery = async () => setGallery((await listScans()).sort((a, b) => b.createdAt - a.createdAt))

  const showToast = (msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }

  useEffect(() => {
    refreshGallery()
    let tries = 0
    const wait = () => {
      if (window.cv?.Mat && window.cv?.imread) {
        scan.current = new JScanify()
        setStatus('Sẵn sàng quét')
        setReady(true)
        startCamera()
      } else if (tries++ < 200) {
        setTimeout(wait, 100)
      } else {
        setError('Không tải được bộ quét. Hãy kiểm tra mạng rồi thử lại.')
      }
    }
    wait()
    return stopped
  }, [])

  async function startCamera() {
    activeCornersRef.current = null
    isDetecting.current = false
    lastDetectTime.current = 0
    stopped(); setError(''); setStatus('Đang mở camera…')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false
      })
      stream.current = s
      video.current.srcObject = s
      await video.current.play()
      setStatus('Đưa tờ giấy vào khung xanh')
      drawLive()
    } catch {
      setError('SCANNER cần quyền camera để quét. Hãy cho phép Camera rồi bấm thử lại.')
      setStatus('Chưa mở được camera')
    }
  }

  function drawLive() {
    const v = video.current, o = live.current
    if (!v || !o || v.readyState < 2) { frame.current = requestAnimationFrame(drawLive); return }

    // Size the overlay canvas to match the displayed video element (CSS pixels)
    const dispW = v.clientWidth || v.offsetWidth || 700
    const dispH = v.clientHeight || v.offsetHeight || Math.round(dispW * v.videoHeight / (v.videoWidth || 1))
    if (o.width !== dispW || o.height !== dispH) { o.width = dispW; o.height = dispH }

    const c = o.getContext('2d')
    // Clear overlay — the <video> element renders the live feed natively at 60 FPS
    c.clearRect(0, 0, o.width, o.height)

    // Throttled detection: kick off an async detection pass at most every 80ms (~12 fps)
    const now = performance.now()
    if (!isDetecting.current && now - lastDetectTime.current > 80) {
      lastDetectTime.current = now
      isDetecting.current = true

      // Prepare / size the offscreen detection canvas (~360px wide)
      const DETECT_MAX = 360
      const detScale = Math.min(1, DETECT_MAX / v.videoWidth)
      const dw = Math.round(v.videoWidth * detScale)
      const dh = Math.round(v.videoHeight * detScale)
      if (!offscreen.current) offscreen.current = document.createElement('canvas')
      const oc = offscreen.current
      if (oc.width !== dw || oc.height !== dh) { oc.width = dw; oc.height = dh }
      oc.getContext('2d').drawImage(v, 0, 0, dw, dh)

      // Run detection off the rAF critical path via a microtask
      Promise.resolve().then(() => {
        try {
          const rawPts = findOptimalCorners(oc)
          if (rawPts) {
            // Scale detected points from offscreen coords to overlay (display) coords
            const scaleToOverlay = { x: o.width / dw, y: o.height / dh }
            const overlayPts = rawPts.map(p => ({
              x: p.x * scaleToOverlay.x,
              y: p.y * scaleToOverlay.y,
            }))
            // Store with videoWidth/Height for use in capture()
            activeCornersRef.current = {
              pts: overlayPts,
              previewWidth: o.width,
              previewHeight: o.height,
              videoWidth: v.videoWidth,
              videoHeight: v.videoHeight,
            }
          } else {
            activeCornersRef.current = null
          }
        } catch {
          activeCornersRef.current = null
        } finally {
          isDetecting.current = false
        }
      })
    }

    // Draw the overlay (document boundary) using the most recently detected corners
    const corners = activeCornersRef.current
    if (corners) {
      const { pts } = corners
      c.strokeStyle = '#10b981'
      c.lineWidth = 4
      c.beginPath()
      c.moveTo(pts[0].x, pts[0].y)
      c.lineTo(pts[1].x, pts[1].y)
      c.lineTo(pts[2].x, pts[2].y)
      c.lineTo(pts[3].x, pts[3].y)
      c.closePath()
      c.stroke()

      c.fillStyle = 'rgba(16, 185, 129, 0.12)'
      c.fill()

      for (const pt of pts) {
        c.fillStyle = '#ffffff'
        c.beginPath()
        c.arc(pt.x, pt.y, 6, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#10b981'
        c.lineWidth = 2
        c.stroke()
      }
    }

    frame.current = requestAnimationFrame(drawLive)
  }

  async function capture() {
    if (processingRef.current || !video.current?.videoWidth) return
    processingRef.current = true
    setProcessing(true)
    try {
      setStatus('Đang nắn thẳng trang…')
      const c = document.createElement('canvas'), v = video.current
      c.width = v.videoWidth; c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      stopped()

      let out = null
      let points = null
      let detectionGood = false

      try {
        // Run detection on the same 360px offscreen canvas used during preview
        const DETECT_MAX = 360
        const detScale = Math.min(1, DETECT_MAX / c.width)
        const dw = Math.round(c.width * detScale)
        const dh = Math.round(c.height * detScale)
        const dc = document.createElement('canvas')
        dc.width = dw; dc.height = dh
        dc.getContext('2d').drawImage(c, 0, 0, dw, dh)

        const scaledPoints = findOptimalCorners(dc)
        if (scaledPoints) {
          // Scale from offscreen coords back to full video resolution
          points = scaledPoints.map(p => ({ x: p.x / detScale, y: p.y / detScale }))
          detectionGood = true
        } else if (activeCornersRef.current?.pts) {
          // Fall back to the last live-preview corners, scaled to full video resolution
          const { pts: livePts, previewWidth, previewHeight, videoWidth: pvw, videoHeight: pvh } = activeCornersRef.current
          // Use stored video dimensions when available for accuracy
          const refW = pvw ?? previewWidth
          const refH = pvh ?? previewHeight
          const scaleX = c.width / refW
          const scaleY = c.height / refH
          points = livePts.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }))
          detectionGood = true
        }
        if (points) out = customExtract(c, points)
      } catch {
        detectionGood = false
      }

      if (detectionGood) {
        const filteredBlob = await blobFrom(canvasFilter(out, 'color'))
        const newPage = { id: uid(), blob: filteredBlob, url: urlOf(filteredBlob) }
        setPendingPage(newPage)
        setFilter('color')
        setScreen('confirm')
        setStatus('Xem lại và xác nhận trang')
      } else {
        const rawBlob = await blobFrom(c)
        setDraft({ raw: urlOf(rawBlob), points: fitPoints(c.width, c.height) })
        setFilter('color')
        setScreen('adjust')
        setStatus('Chỉnh lại 4 góc')
      }
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  async function applyManual() {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    try {
      setError('')
      const img = await loadImage(draft.raw)
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0)
      let out
      try {
        out = customExtract(c, draft.points)
      } catch {
        setError('Không thể nắn thẳng trang. Hãy chỉnh lại 4 góc rồi thử lại.')
        return
      }

      const filtered = canvasFilter(out, filter)
      const filteredBlob = await blobFrom(filtered)

      const newPage = {
        id: uid(),
        blob: filteredBlob,
        url: urlOf(filteredBlob),
      }

      setDraft(null)
      setPendingPage(newPage)
      setScreen('confirm')
      setStatus('Xem lại và xác nhận trang')
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  async function confirmPage() {
    if (processingRef.current || !pendingPage) return
    processingRef.current = true
    setProcessing(true)
    const page = pendingPage
    try {
      setPages(p => {
        const updated = [...p, page]
        showToast(`Đã thêm trang ${updated.length}`)
        return updated
      })
      setPendingPage(null)
      setScreen('camera')
      setStatus('Đưa tờ giấy vào khung xanh')
      await new Promise(resolve => setTimeout(resolve, 100))
      await startCamera()
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  async function retakePage() {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    const page = pendingPage
    try {
      if (page) {
        URL.revokeObjectURL(page.url)
        setPendingPage(null)
      }
      setScreen('camera')
      setStatus('Đưa tờ giấy vào khung xanh')
      await new Promise(resolve => setTimeout(resolve, 100))
      await startCamera()
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  const download = (blob, name) => {
    const a = document.createElement('a')
    a.href = urlOf(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 500)
  }

  // Export PDF from the current cart (pages[]) and save to gallery
  async function exportCartPdf() {
    if (processingRef.current || !pages.length) return
    processingRef.current = true
    setProcessing(true)
    const items = [...pages]
    try {
      setStatus('Đang tạo PDF…')
      let pdf = null
      for (let i = 0; i < items.length; i++) {
        const im = await loadImage(items[i].url)
        const imgWidth = im.naturalWidth || im.width
        const imgHeight = im.naturalHeight || im.height
        const orientation = imgWidth > imgHeight ? 'l' : 'p'

        if (i === 0) {
          pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [imgWidth, imgHeight],
            hotfixes: ['px_scaling']
          })
        } else {
          pdf.addPage([imgWidth, imgHeight], orientation)
        }
        pdf.addImage(items[i].url, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST')
      }
      const b = pdf.output('blob')
      const name = docName.trim() || defaultDocName()
      download(b, `${name}.pdf`)

      const record = {
        id: uid(),
        name,
        createdAt: Date.now(),
        pages: items.map(x => x.blob),
      }
      await putScan(record)
      await refreshGallery()
      items.forEach(page => URL.revokeObjectURL(page.url))
      setPages([])
      setDocName(defaultDocName())
      setScreen('camera')
      setStatus('Đã lưu PDF trong Thư viện')
      await new Promise(resolve => setTimeout(resolve, 100))
      await startCamera()
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  // Export PDF from a gallery record (view-only)
  async function exportRecordPdf(record) {
    if (!record?.pages?.length) return
    setStatus('Đang tạo PDF…')
    let pdf = null
    const items = record.pages.map(blob => ({ blob, url: urlOf(blob) }))
    for (let i = 0; i < items.length; i++) {
      const im = await loadImage(items[i].url)
      const imgWidth = im.naturalWidth || im.width
      const imgHeight = im.naturalHeight || im.height
      const orientation = imgWidth > imgHeight ? 'l' : 'p'
      if (i === 0) {
        pdf = new jsPDF({ orientation, unit: 'px', format: [imgWidth, imgHeight], hotfixes: ['px_scaling'] })
      } else {
        pdf.addPage([imgWidth, imgHeight], orientation)
      }
      pdf.addImage(items[i].url, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST')
      URL.revokeObjectURL(items[i].url)
    }
    const b = pdf.output('blob')
    download(b, `${record.name}.pdf`)
    setStatus('Sẵn sàng quét')
  }

  function movePage(from, to) {
    if (to < 0 || to >= pages.length) return
    setPages(p => { const n = [...p]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })
  }

  function removePage(idx) {
    URL.revokeObjectURL(pages[idx].url)
    setPages(p => p.filter((_, i) => i !== idx))
  }

  async function openRecord(r) {
    setViewRecord(r)
    setScreen('gallery-view')
  }

  /* ───────── Lightbox overlay (rendered on top of any screen) ───────── */
  const LightboxOverlay = lightbox ? (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-2xl p-4 transition-all animate-in fade-in duration-200"
      onClick={() => setLightbox(null)}
    >
      <button
        onClick={() => setLightbox(null)}
        className="absolute right-5 top-safe mt-4 z-50 flex h-11 w-11 items-center justify-center rounded-full glass-panel text-white active:scale-95 transition-all shadow-xl"
        aria-label="Đóng"
      >
        <X className="h-6 w-6 stroke-[2.5]" />
      </button>
      <img
        src={lightbox}
        onClick={e => e.stopPropagation()}
        className="max-h-[85vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl ring-1 ring-white/10"
        alt="Xem ảnh"
      />
    </div>
  ) : null

  /* ───────── Capture Confirmation Screen ───────── */
  if (screen === 'confirm') return (
    <>
      {LightboxOverlay}
      <main className="safe flex min-h-full flex-col justify-between bg-slate-950 p-5">
        <Header back={retakePage} title="Xem lại trang" />

        <div className="flex flex-1 flex-col items-center justify-center my-2">
          {pendingPage && (
            <div className="relative group cursor-zoom-in" onClick={() => setLightbox(pendingPage.url)}>
              <img
                src={pendingPage.url}
                className="max-h-[58vh] max-w-[88vw] rounded-2xl object-contain paper-shadow transition-transform active:scale-[0.99]"
                alt="Trang đã quét"
              />
              <div className="absolute bottom-3 right-3 rounded-full glass-pill px-3 py-1.5 text-xs font-medium text-white/80 shadow-md backdrop-blur-md pointer-events-none">
                Chạm để phóng to
              </div>
            </div>
          )}
          <p className="mt-4 text-sm font-medium text-slate-400">Trang quét thành công. Xác nhận để thêm vào giỏ.</p>
        </div>

        <div className="flex w-full gap-3 pt-2">
          <button
            disabled={processing}
            className="tap flex-1 flex items-center justify-center gap-2 rounded-2xl glass-panel py-4 text-lg font-semibold text-slate-200 active:scale-95 transition-all disabled:opacity-50"
            onClick={retakePage}
          >
            <RotateCcw className="h-5 w-5" />
            <span>Chụp lại</span>
          </button>
          <button
            disabled={processing}
            className="tap flex-1 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-4 text-lg font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
            onClick={confirmPage}
          >
            <Check className="h-5 w-5 stroke-[2.5]" />
            <span>Xác nhận thêm</span>
          </button>
        </div>
      </main>
    </>
  )

  /* ───────── Gallery Screen ───────── */
  if (screen === 'gallery') return (
    <main className="safe min-h-full bg-slate-950 p-5 flex flex-col">
      <Header back={() => { setScreen('camera'); startCamera() }} title="Thư viện tài liệu" />
      {gallery.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center backdrop-blur-xl">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full glass-pill text-slate-400">
            <FolderOpen className="h-8 w-8 stroke-[1.5]" />
          </div>
          <h3 className="text-xl font-bold text-white">Chưa có tài liệu nào</h3>
          <p className="mt-2 text-sm text-slate-400 max-w-xs">Bắt đầu quét tài liệu đầu tiên bằng camera siêu nét.</p>
          <button
            className="mt-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 px-6 py-3.5 font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
            onClick={() => { setScreen('camera'); startCamera() }}
          >
            <Camera className="h-5 w-5" />
            <span>Quét trang đầu tiên</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {gallery.map(r => (
            <div
              key={r.id}
              className="group relative flex items-center gap-4 rounded-2xl glass-panel p-4 shadow-lg transition-all active:scale-[0.99]"
            >
              <div
                className="flex flex-col items-center justify-center h-14 w-14 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex-shrink-0"
              >
                <span className="text-xl font-black">{r.pages.length}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider -mt-1">Trang</span>
              </div>

              <button className="flex-1 text-left min-w-0" onClick={() => openRecord(r)}>
                <b className="block text-lg font-bold text-white truncate">{r.name}</b>
                <span className="text-xs text-slate-400 mt-0.5 block">{label(r.createdAt)}</span>
              </button>

              <button
                aria-label="Xóa"
                className="tap flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 active:scale-90 transition-all"
                onClick={async () => {
                  if (confirm('Xóa tài liệu này khỏi điện thoại?')) {
                    await removeScan(r.id)
                    refreshGallery()
                  }
                }}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  )

  /* ───────── Gallery View Screen (read-only record viewer) ───────── */
  if (screen === 'gallery-view') {
    const rec = viewRecord
    return (
      <>
        {LightboxOverlay}
        <main className="safe min-h-full bg-slate-950 p-5 flex flex-col justify-between">
          <div>
            <Header back={() => { setViewRecord(null); setScreen('gallery') }} title={rec?.name ?? 'Tài liệu'} />
            <div className="mb-5 flex items-center justify-between text-xs text-slate-400 border-b border-white/5 pb-3">
              <span>{rec?.pages.length ?? 0} trang tài liệu</span>
              <span>{rec ? label(rec.createdAt) : ''}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-[62vh] overflow-y-auto pr-1 pb-4">
              {viewedPages.map((p, i) => (
                <div
                  key={p.id}
                  onClick={() => setLightbox(p.url)}
                  className="group relative cursor-zoom-in rounded-2xl glass-panel p-2.5 overflow-hidden transition-all active:scale-95"
                >
                  <img
                    src={p.url}
                    className="h-44 w-full rounded-xl object-cover shadow-inner"
                    alt={`Trang ${i + 1}`}
                  />
                  <div className="absolute top-4 left-4 rounded-lg glass-pill px-2.5 py-1 text-xs font-bold text-white shadow-md">
                    Trang {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            className="tap mt-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-4 text-lg font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
            onClick={() => exportRecordPdf(rec)}
          >
            <Download className="h-5 w-5 stroke-[2.5]" />
            <span>Xuất lại file PDF</span>
          </button>
        </main>
      </>
    )
  }

  /* ───────── Cart Screen (active scan session) ───────── */
  if (screen === 'cart') return (
    <>
      {LightboxOverlay}
      <main className="safe min-h-full bg-slate-950 p-5 flex flex-col justify-between">
        <div>
          <Header back={() => { setScreen('camera'); startCamera() }} title="Giỏ trang quét" />

          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Tên tài liệu xuất</label>
            <div className="relative">
              <input
                className="w-full rounded-2xl glass-panel px-4 py-3.5 text-base font-semibold text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
                value={docName}
                onChange={e => setDocName(e.target.value)}
                placeholder="Nhập tên tài liệu…"
              />
            </div>
          </div>

          {pages.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center backdrop-blur-xl">
              <Layers className="mx-auto h-12 w-12 text-slate-500 stroke-[1.5] mb-3" />
              <p className="text-lg font-semibold text-slate-300">Chưa có trang nào trong giỏ</p>
              <p className="mt-1 text-sm text-slate-400">Bấm chụp tiếp để quét các trang tài liệu.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[54vh] overflow-y-auto pr-1 pb-4">
              {pages.map((p, i) => (
                <div
                  draggable={!processing}
                  onDragStart={() => setDrag(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { movePage(drag, i); setDrag(null) }}
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl glass-panel p-3 shadow-md transition-all"
                >
                  <img
                    src={p.url}
                    className="h-20 w-16 cursor-zoom-in rounded-xl object-cover ring-1 ring-white/10 active:scale-95 transition-transform"
                    onClick={() => setLightbox(p.url)}
                    alt={`Trang ${i + 1}`}
                  />
                  <div className="flex-1 min-w-0">
                    <b className="block text-base font-bold text-white">Trang {i + 1}</b>
                    <span className="text-xs text-slate-400">Kéo thả hoặc bấm mũi tên để xếp</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={processing || i === 0}
                      className="tap flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 active:scale-90 transition-all disabled:opacity-30"
                      onClick={() => movePage(i, i - 1)}
                      aria-label="Di chuyển lên"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      disabled={processing || i === pages.length - 1}
                      className="tap flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 active:scale-90 transition-all disabled:opacity-30"
                      onClick={() => movePage(i, i + 1)}
                      aria-label="Di chuyển xuống"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      aria-label="Xóa trang"
                      disabled={processing}
                      className="tap flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-400 active:scale-90 transition-all disabled:opacity-30 ml-1"
                      onClick={() => removePage(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 pt-4">
          {pages.length > 0 && (
            <button
              disabled={processing}
              className="tap flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-4 text-lg font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
              onClick={exportCartPdf}
            >
              <Download className="h-5 w-5 stroke-[2.5]" />
              <span>Xong &amp; Xuất PDF ({pages.length} trang)</span>
            </button>
          )}
          <button
            disabled={processing}
            className="tap flex w-full items-center justify-center gap-2 rounded-2xl glass-panel py-3.5 text-base font-semibold text-slate-200 active:scale-95 transition-all disabled:opacity-50"
            onClick={() => { setScreen('camera'); startCamera() }}
          >
            <Camera className="h-5 w-5" />
            <span>Chụp thêm trang</span>
          </button>
        </div>
      </main>
    </>
  )

  /* ───────── Adjust Screen ───────── */
  if (screen === 'adjust') return (
    <main className="safe min-h-full bg-slate-950 p-4 flex flex-col justify-between">
      <div>
        <Header disabled={processing} back={() => { setDraft(null); setError(''); setScreen('camera'); startCamera() }} title="Chỉnh 4 góc" />
        <Adjust key={draft.raw} image={draft.raw} points={draft.points} setPoints={p => setDraft(d => ({ ...d, points: p }))} />
        {error && <p className="mt-3 rounded-2xl bg-red-950/80 border border-red-500/30 p-3 text-sm text-red-200">{error}</p>}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ['color', 'Ảnh gốc'],
            ['gray', 'Xám rõ nét'],
            ['bw', 'Đen trắng']
          ].map(([k, n]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`tap rounded-xl py-3 px-2 text-sm font-bold transition-all active:scale-95 ${
                filter === k
                  ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'glass-panel text-slate-300'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={processing}
        className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-4 text-lg font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
        onClick={applyManual}
      >
        <Check className="h-5 w-5 stroke-[2.5]" />
        <span>Áp dụng 4 góc &amp; Cắt</span>
      </button>
    </main>
  )

  /* ───────── Camera Screen (default) ───────── */
  return (
    <main className="safe flex min-h-full flex-col bg-slate-950 justify-between">
      <header className="px-4 pt-1 pb-2">
        <div className="flex items-center justify-between rounded-2xl glass-panel px-4 py-2.5 shadow-xl">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/20 text-emerald-400 border border-emerald-400/30">
              <Camera className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white leading-none">SCANNER</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[11px] font-medium text-emerald-400">{status}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={processing}
              onClick={() => { stopped(); setScreen('cart') }}
              className="tap flex items-center gap-1.5 rounded-xl bg-emerald-400/15 border border-emerald-400/30 px-3 py-1.5 text-xs font-bold text-emerald-300 active:scale-95 transition-all disabled:opacity-50"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{pages.length} trang</span>
            </button>

            <button
              disabled={processing}
              onClick={() => { stopped(); setScreen('gallery') }}
              className="tap flex items-center justify-center rounded-xl glass-pill h-8 w-8 text-slate-200 active:scale-95 transition-all disabled:opacity-50"
              aria-label="Thư viện"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative mx-4 my-1 flex-1 overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={live} className="absolute inset-0 h-full w-full object-fill" />

        <div className="pointer-events-none absolute inset-6 flex flex-col justify-between opacity-60">
          <div className="flex justify-between">
            <div className="h-6 w-6 border-t-2 border-l-2 border-white/70 rounded-tl-sm" />
            <div className="h-6 w-6 border-t-2 border-r-2 border-white/70 rounded-tr-sm" />
          </div>
          <div className="flex justify-between">
            <div className="h-6 w-6 border-b-2 border-l-2 border-white/70 rounded-bl-sm" />
            <div className="h-6 w-6 border-b-2 border-r-2 border-white/70 rounded-br-sm" />
          </div>
        </div>

        {error && (
          <div className="absolute inset-x-4 top-4 rounded-2xl glass-panel p-4 text-center text-sm shadow-xl backdrop-blur-2xl">
            <p className="text-slate-200">{error}</p>
            <button
              onClick={startCamera}
              className="tap mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-5 py-2 text-sm font-bold text-slate-950 active:scale-95 transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Thử lại</span>
            </button>
          </div>
        )}

        {toast && (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="flex items-center gap-2 rounded-full glass-panel px-5 py-2.5 text-sm font-bold text-emerald-400 shadow-2xl border border-emerald-400/30">
              <Check className="h-4 w-4 stroke-[3]" />
              <span>{toast}</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-2 pb-4 text-center">
        <p className="mb-3 text-xs font-medium text-slate-400 tracking-wide">
          Đặt tài liệu trong khung xanh để tự động nhận diện
        </p>

        <div className="flex items-center justify-center">
          <button
            disabled={!ready || processing}
            onClick={capture}
            aria-label="Chụp tài liệu"
            className="group relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/80 p-1 active:scale-90 transition-transform duration-150 disabled:opacity-40"
          >
            <span className="h-full w-full rounded-full bg-white transition-transform group-active:scale-95 shadow-inner" />
          </button>
        </div>

      </div>
    </main>
  )
}

function Header({ back, title, disabled = false }) {
  return (
    <header className="mb-4 flex items-center gap-3">
      <button
        disabled={disabled}
        onClick={back}
        className="tap flex h-10 w-10 items-center justify-center rounded-xl glass-panel text-slate-200 active:scale-90 transition-all disabled:opacity-50 shadow-md"
        aria-label="Quay lại"
      >
        <ChevronLeft className="h-6 w-6 stroke-[2.5]" />
      </button>
      <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
    </header>
  )
}

function Adjust({ image, points, setPoints }) {
  const ref = useRef()
  const dragIdx = useRef(null)
  const [imageSize, setImageSize] = useState(null)

  const update = e => {
    if (dragIdx.current === null) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    setPoints(p => p.map((v, i) => i === dragIdx.current
      ? { x: x * imageSize.width, y: y * imageSize.height }
      : v
    ))
  }

  return (
    <div className="mx-auto max-h-[62vh] w-fit rounded-2xl overflow-hidden glass-panel p-2 shadow-2xl">
      <div
        ref={ref}
        onPointerMove={update}
        onPointerUp={() => dragIdx.current = null}
        className="relative w-fit"
      >
        <img
          src={image}
          onLoad={e => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          className="block max-h-[60vh] max-w-full rounded-xl object-contain"
          alt="Ảnh gốc"
        />
        {imageSize && points.map((p, i) => (
          <button
            key={i}
            onPointerDown={e => { dragIdx.current = i; e.currentTarget.setPointerCapture(e.pointerId) }}
            aria-label={`Góc ${i + 1}`}
            className="corner absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-400 shadow-xl ring-4 ring-black/30 active:scale-125 transition-transform"
            style={{
              left: `${(p.x / imageSize.width) * 100}%`,
              top: `${(p.y / imageSize.height) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
