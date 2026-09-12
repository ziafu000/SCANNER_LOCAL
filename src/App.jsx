import { useEffect, useRef, useState } from 'react'
import JScanify from 'jscanify/client'
import { jsPDF } from 'jspdf'
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
  const activeCornersRef = useRef(null) // last green-box corners seen in the live preview (preview coords)
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
    const max = 700, scale = Math.min(1, max / v.videoWidth)
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale)
    if (o.width !== w) { o.width = w; o.height = h }
    const c = o.getContext('2d')
    c.drawImage(v, 0, 0, w, h)
    try {
      const pts = findOptimalCorners(o)
      if (pts) {
        activeCornersRef.current = { pts, previewWidth: w, previewHeight: h }
        c.strokeStyle = '#20e3a2'
        c.lineWidth = 7
        c.beginPath()
        c.moveTo(pts[0].x, pts[0].y)
        c.lineTo(pts[1].x, pts[1].y)
        c.lineTo(pts[2].x, pts[2].y)
        c.lineTo(pts[3].x, pts[3].y)
        c.closePath()
        c.stroke()
      } else {
        activeCornersRef.current = null
      }
    } catch {
      activeCornersRef.current = null
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
      let detectionGood = false // true if we found a clean 4-corner quad

      try {
        const max = 700, scale = Math.min(1, max / c.width)
        const dw = Math.round(c.width * scale), dh = Math.round(c.height * scale)
        const dc = document.createElement('canvas')
        dc.width = dw; dc.height = dh
        dc.getContext('2d').drawImage(c, 0, 0, dw, dh)

        const scaledPoints = findOptimalCorners(dc)
        if (scaledPoints) {
          points = scaledPoints.map(p => ({ x: p.x / scale, y: p.y / scale }))
          detectionGood = true
        } else if (activeCornersRef.current?.pts) {
          const { pts: livePts, previewWidth, previewHeight } = activeCornersRef.current
          const scaleX = c.width / previewWidth
          const scaleY = c.height / previewHeight
          points = livePts.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }))
          detectionGood = true
        }
        if (points) out = customExtract(c, points)
      } catch {
        detectionGood = false
      }

      if (detectionGood) {
        const filteredBlob = await blobFrom(canvasFilter(out, 'color'))
        setPages(p => [...p, { id: uid(), blob: filteredBlob, url: urlOf(filteredBlob) }])
        showToast(`Đã thêm trang ${pages.length + 1}`)
        setFilter('color')
        setStatus('Đưa tờ giấy vào khung xanh')
        await new Promise(resolve => setTimeout(resolve, 100))
        await startCamera()
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

      setPages(p => {
        const updated = [...p, newPage]
        showToast(`Đã thêm trang ${updated.length}`)
        return updated
      })
      setDraft(null)
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

  /* ───────── Gallery Screen ───────── */
  if (screen === 'gallery') return (
    <main className="safe min-h-full bg-slate-950 p-5">
      <Header back={() => { setScreen('camera'); startCamera() }} title="Thư viện" />
      <p className="mb-5 text-slate-300">Chỉ lưu trên điện thoại này. Không tải lên mạng.</p>
      {gallery.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-600 p-10 text-center text-xl text-slate-300">
          Chưa có tài liệu nào.
          <br />
          <button className="mt-5 rounded-2xl bg-emerald-400 px-6 py-4 font-bold text-slate-950" onClick={() => { setScreen('camera'); startCamera() }}>
            Quét trang đầu tiên
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {gallery.map(r => (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-slate-800 p-3">
              <div className="grid h-14 w-12 place-items-center rounded-lg bg-emerald-300 font-black text-slate-950">{r.pages.length}</div>
              <button className="flex-1 text-left" onClick={() => openRecord(r)}>
                <b className="block text-lg">{r.name}</b>
                <span className="text-slate-300">{r.pages.length} trang · {label(r.createdAt)}</span>
              </button>
              <button aria-label="Xóa" className="tap rounded-xl bg-slate-700 px-3 py-2 text-2xl"
                onClick={async () => { if (confirm('Xóa tài liệu này khỏi điện thoại?')) { await removeScan(r.id); refreshGallery() } }}>
                🗑
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
      <main className="safe min-h-full bg-slate-950 p-5">
        <Header back={() => { setViewRecord(null); setScreen('gallery') }} title={rec?.name ?? 'Tài liệu'} />
        <p className="mb-4 text-slate-300">{rec?.pages.length ?? 0} trang · {rec ? label(rec.createdAt) : ''}</p>
        <div className="space-y-3">
          {viewedPages.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-slate-800 p-3">
              <img src={p.url} className="h-24 w-18 rounded object-cover" />
              <b className="flex-1 text-xl">Trang {i + 1}</b>
            </div>
          ))}
        </div>
        <button className="tap mt-5 w-full rounded-2xl bg-emerald-400 p-4 text-xl font-black text-slate-950"
          onClick={() => exportRecordPdf(rec)}>
          Xuất PDF lại
        </button>
      </main>
    )
  }

  /* ───────── Cart Screen (active scan session) ───────── */
  if (screen === 'cart') return (
    <main className="safe min-h-full bg-slate-950 p-5">
      <Header back={() => { setScreen('camera'); startCamera() }} title="Giỏ trang quét" />
      {/* Editable document name */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-slate-400">Tên tài liệu</label>
        <input
          className="w-full rounded-xl bg-slate-800 px-4 py-3 text-lg font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
          value={docName}
          onChange={e => setDocName(e.target.value)}
          placeholder="Nhập tên tài liệu…"
        />
      </div>
      {pages.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-600 p-10 text-center text-xl text-slate-300">
          Chưa có trang nào trong giỏ.
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((p, i) => (
            <div
              draggable={!processing}
              onDragStart={() => setDrag(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { movePage(drag, i); setDrag(null) }}
              key={p.id}
              className="flex items-center gap-3 rounded-2xl bg-slate-800 p-3"
            >
              <img src={p.url} className="h-24 w-18 rounded object-cover" />
              <b className="flex-1 text-xl">Trang {i + 1}</b>
              <div className="flex flex-col gap-1">
                <button disabled={processing} className="tap text-2xl disabled:opacity-50" onClick={() => movePage(i, i - 1)}>↑</button>
                <button disabled={processing} className="tap text-2xl disabled:opacity-50" onClick={() => movePage(i, i + 1)}>↓</button>
              </div>
              <button
                aria-label="Xóa trang"
                disabled={processing}
                className="tap rounded-xl bg-slate-700 px-3 py-2 text-2xl disabled:opacity-50"
                onClick={() => removePage(i)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      {pages.length > 0 && (
        <button
          disabled={processing}
          className="tap mt-5 w-full rounded-2xl bg-emerald-400 p-4 text-xl font-black text-slate-950 disabled:opacity-50"
          onClick={exportCartPdf}
        >
          Xong &amp; Xuất PDF
        </button>
      )}
    </main>
  )

  /* ───────── Adjust Screen ───────── */
  if (screen === 'adjust') return (
    <main className="safe min-h-full bg-slate-950 p-4">
      <Header disabled={processing} back={() => { setDraft(null); setError(''); setScreen('camera'); startCamera() }} title="Chỉnh 4 góc" />
      <Adjust key={draft.raw} image={draft.raw} points={draft.points} setPoints={p => setDraft(d => ({ ...d, points: p }))} />
      {error && <p className="mt-3 rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}
      {/* Filter selection while adjusting */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[['color', 'Màu'], ['gray', 'Xám'], ['bw', 'Đen trắng']].map(([k, n]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`tap rounded-xl border-2 p-2 font-bold ${filter === k ? 'border-emerald-300 bg-emerald-300 text-slate-950' : 'border-slate-500'}`}>
            {n}
          </button>
        ))}
      </div>
      <button disabled={processing} className="tap mt-4 w-full rounded-2xl bg-emerald-400 p-4 text-xl font-black text-slate-950 disabled:opacity-50" onClick={applyManual}>
        Áp dụng 4 góc
      </button>
    </main>
  )

  /* ───────── Camera Screen (default) ───────── */
  return (
    <main className="safe flex min-h-full flex-col bg-slate-950">
      <header className="flex items-center justify-between px-5">
        <div>
          <h1 className="text-2xl font-black tracking-wide">SCANNER</h1>
          <p className="text-sm text-emerald-300">{status}</p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={processing}
            onClick={() => { stopped(); setScreen('cart') }}
            className="tap rounded-xl border border-emerald-400 bg-emerald-400/10 px-3 py-2 font-bold text-emerald-300 disabled:opacity-50"
          >
            🛒 {pages.length} trang
          </button>
          <button disabled={processing} onClick={() => { stopped(); setScreen('gallery') }} className="tap rounded-xl border border-slate-500 px-3 py-2 font-bold disabled:opacity-50">Thư viện</button>
        </div>
      </header>
      <div className="relative mx-3 mt-4 flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={live} className="absolute inset-0 h-full w-full object-fill" />
        {error && (
          <div className="absolute inset-x-3 top-3 rounded-2xl bg-slate-950/95 p-4 text-center text-lg">
            <p>{error}</p>
            <button onClick={startCamera} className="tap mt-3 rounded-xl bg-emerald-400 px-5 py-2 font-black text-slate-950">Thử lại</button>
          </div>
        )}
        {/* Toast notification */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-6 bottom-6 flex justify-center">
            <span className="rounded-2xl bg-emerald-400 px-5 py-3 text-lg font-black text-slate-950 shadow-lg">
              {toast}
            </span>
          </div>
        )}
      </div>
      <div className="p-5 text-center">
        <p className="mb-3 text-lg font-semibold">Đặt giấy vào khung, rồi bấm nút tròn</p>
        <button disabled={!ready || processing} onClick={capture} aria-label="Chụp tài liệu"
          className="tap mx-auto grid h-24 w-24 place-items-center rounded-full border-8 border-white bg-emerald-400 shadow-lg disabled:opacity-50">
          <span className="h-14 w-14 rounded-full bg-white" />
        </button>
        <p className="mt-3 text-sm text-slate-300">Không có tài khoản · Không tải ảnh lên mạng</p>
      </div>
    </main>
  )
}

function Header({ back, title, disabled = false }) {
  return (
    <header className="mb-5 flex items-center gap-3">
      <button disabled={disabled} onClick={back} className="tap rounded-xl border border-slate-500 px-3 py-2 text-xl disabled:opacity-50">←</button>
      <h1 className="text-2xl font-black">{title}</h1>
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
    <div ref={ref} onPointerMove={update} onPointerUp={() => dragIdx.current = null} className="relative mx-auto max-h-[65vh] w-fit">
      <img
        src={image}
        onLoad={e => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        className="max-h-[65vh] max-w-full"
        alt="Ảnh gốc"
      />
      {imageSize && points.map((p, i) => (
        <button key={i}
          onPointerDown={e => { dragIdx.current = i; e.currentTarget.setPointerCapture(e.pointerId) }}
          aria-label={`Góc ${i + 1}`}
          className="corner absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-emerald-400"
          style={{
            left: `${(p.x / imageSize.width) * 100}%`,
            top: `${(p.y / imageSize.height) * 100}%`,
          }}
        />
      ))}
    </div>
  )
}
