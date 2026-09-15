/**
 * Document enhancement filters (CamScanner style).
 * Supports:
 * - 'original': Raw warped document image
 * - 'magic_color': Paper whitening, CLAHE/contrast tone-curve, color saturation boost for stamps, unsharp masking
 * - 'lighten': Clean brightening of paper tone and midtones
 * - 'shadow_removal': Background illumination estimation & division (removes hand/phone shadows)
 * - 'bw': Adaptive local thresholding (pure white background, sharp black text)
 * - 'grayscale': Smooth 8-bit monochromatic output with edge-preserving noise reduction
 */

export const FILTER_PRESETS = [
  { id: 'original', label: 'Bản gốc' },
  { id: 'magic_color', label: 'Tăng cường' },
  { id: 'lighten', label: 'Làm sáng' },
  { id: 'shadow_removal', label: 'Không bóng' },
  { id: 'bw', label: 'Đen trắng' },
  { id: 'grayscale', label: 'Thang xám' },
]

/**
 * Creates a regular Canvas (if document available) or OffscreenCanvas.
 */
function createCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h)
    } catch {
      // Fallback if OffscreenCanvas fails
    }
  }
  return null
}

/**
 * Converts ImageData in-place or returns processed pixel array for 'magic_color'.
 * Whitens paper, boosts stamp/ink colors, deepens text, sharpens edges.
 */
export function filterMagicColor(pixels, width, height) {
  const n = pixels.length
  // Step 1: Contrast enhancement and paper whitening with color preservation
  for (let i = 0; i < n; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b

    // Color saturation metric
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const sat = maxC - minC

    let newLum
    if (lum > 175) {
      // Whiten paper highlights
      const t = (lum - 175) / 80
      newLum = lum + (255 - lum) * Math.min(1, t * 1.35)
    } else if (lum < 110) {
      // Deepen dark text
      newLum = lum * 0.88
    } else {
      // Smooth S-curve contrast in midtones
      const norm = (lum - 110) / 65
      newLum = 110 * 0.88 + norm * (175 + (255 - 175) * 0.3 - 110 * 0.88)
    }
    newLum = Math.max(0, Math.min(255, newLum))

    if (sat > 18) {
      // Preserve and boost color for seals, signatures, diagrams
      const boost = 1.25
      const avg = (r + g + b) / 3
      const cr = avg + (r - avg) * boost
      const cg = avg + (g - avg) * boost
      const cb = avg + (b - avg) * boost
      const lumRatio = (newLum + 1) / (lum + 1)
      pixels[i] = Math.max(0, Math.min(255, Math.round(cr * lumRatio)))
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(cg * lumRatio)))
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(cb * lumRatio)))
    } else {
      // Monochrome/paper region: apply adjusted luminance
      const lumDelta = newLum - lum
      pixels[i] = Math.max(0, Math.min(255, Math.round(r + lumDelta)))
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g + lumDelta)))
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b + lumDelta)))
    }
  }

  // Step 2: Unsharp masking on luminance to make text razor-sharp
  unsharpMask(pixels, width, height, 0.45)
  return pixels
}

/**
 * Fast 3x3 unsharp mask applied directly to RGB buffer.
 */
function unsharpMask(pixels, width, height, strength = 0.4) {
  if (width < 3 || height < 3) return
  // Sample a copy for neighborhood reading
  const copy = new Uint8ClampedArray(pixels)
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width * 4
    const rowPrev = (y - 1) * width * 4
    const rowNext = (y + 1) * width * 4
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x * 4
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c]
        const blur = (
          copy[rowPrev + x * 4 + c] +
          copy[rowNext + x * 4 + c] +
          copy[rowOffset + (x - 1) * 4 + c] +
          copy[rowOffset + (x + 1) * 4 + c]
        ) * 0.25
        const sharp = center + strength * (center - blur)
        pixels[idx + c] = Math.max(0, Math.min(255, Math.round(sharp)))
      }
    }
  }
}

/**
 * Shadow removal via illumination estimation and division.
 */
export function filterShadowRemoval(pixels, width, height) {
  const n = pixels.length
  // Estimate background illumination across an adaptive block grid
  const minDim = Math.min(width, height)
  const blockSize = Math.max(4, Math.min(48, Math.round(minDim / 8)))
  const gridW = Math.ceil(width / blockSize)
  const gridH = Math.ceil(height / blockSize)
  const bgGrid = new Float32Array(gridW * gridH)

  // Find 90th percentile / max luminance in each block (representing background paper)
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const startX = gx * blockSize
      const endX = Math.min(width, startX + blockSize)
      const startY = gy * blockSize
      const endY = Math.min(height, startY + blockSize)

      let maxLum = 0
      for (let y = startY; y < endY; y += 2) {
        const row = y * width * 4
        for (let x = startX; x < endX; x += 2) {
          const idx = row + x * 4
          const l = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]
          if (l > maxLum) maxLum = l
        }
      }
      bgGrid[gy * gridW + gx] = Math.max(maxLum, 40)
    }
  }

  // Divide each pixel by interpolated background illumination
  for (let y = 0; y < height; y++) {
    const gy = y / blockSize
    const gy0 = Math.min(gridH - 1, Math.floor(gy))
    const gy1 = Math.min(gridH - 1, gy0 + 1)
    const ty = gy - gy0
    const rowOffset = y * width * 4

    for (let x = 0; x < width; x++) {
      const gx = x / blockSize
      const gx0 = Math.min(gridW - 1, Math.floor(gx))
      const gx1 = Math.min(gridW - 1, gx0 + 1)
      const tx = gx - gx0

      // Bilinear interpolation of background brightness
      const b00 = bgGrid[gy0 * gridW + gx0]
      const b10 = bgGrid[gy0 * gridW + gx1]
      const b01 = bgGrid[gy1 * gridW + gx0]
      const b11 = bgGrid[gy1 * gridW + gx1]
      const bgLum = (b00 * (1 - tx) + b10 * tx) * (1 - ty) + (b01 * (1 - tx) + b11 * tx) * ty

      const scale = 245 / Math.max(bgLum, 30)
      const idx = rowOffset + x * 4
      pixels[idx] = Math.min(255, Math.round(pixels[idx] * scale))
      pixels[idx + 1] = Math.min(255, Math.round(pixels[idx + 1] * scale))
      pixels[idx + 2] = Math.min(255, Math.round(pixels[idx + 2] * scale))
    }
  }

  return pixels
}

/**
 * Clean Document B&W filter using Adaptive Thresholding via Integral Image.
 */
export function filterBlackAndWhite(pixels, width, height) {
  const numPixels = width * height
  const gray = new Uint8Array(numPixels)

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4
    gray[i] = Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2])
  }

  // Build integral image (Summed Area Table)
  const integral = new Float64Array((width + 1) * (height + 1))
  const stride = width + 1

  for (let y = 0; y < height; y++) {
    let sum = 0
    const rowIn = y * width
    const rowIntPrev = y * stride
    const rowIntCurr = (y + 1) * stride

    for (let x = 0; x < width; x++) {
      sum += gray[rowIn + x]
      integral[rowIntCurr + x + 1] = integral[rowIntPrev + x + 1] + sum
    }
  }

  // Window radius for local threshold
  const radius = Math.max(8, Math.min(28, Math.round(Math.min(width, height) / 32)))
  const cOffset = 8 // contrast delta threshold

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    const rowInt0 = y0 * stride
    const rowInt1 = y1 * stride
    const rowOffset = y * width * 4

    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const count = (x1 - x0) * (y1 - y0)
      const sum = integral[rowInt1 + x1] - integral[rowInt0 + x1] - integral[rowInt1 + x0] + integral[rowInt0 + x0]
      const localMean = sum / count

      const g = gray[y * width + x]
      const val = g < (localMean - cOffset) ? 0 : 255
      const idx = rowOffset + x * 4
      pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = val
    }
  }

  return pixels
}

/**
 * Lighten filter: brightens paper and expands dynamic range.
 */
export function filterLighten(pixels) {
  const n = pixels.length
  for (let i = 0; i < n; i += 4) {
    pixels[i] = Math.min(255, Math.round(pixels[i] * 1.14 + 14))
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * 1.14 + 14))
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * 1.10 + 10))
  }
  return pixels
}

/**
 * Grayscale filter with smoothing.
 */
export function filterGrayscale(pixels) {
  const n = pixels.length
  for (let i = 0; i < n; i += 4) {
    const v = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v
  }
  return pixels
}

/**
 * Applies a filter to a source canvas or returns a new canvas.
 *
 * @param {HTMLCanvasElement | OffscreenCanvas} sourceCanvas
 * @param {string} filterKind
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
export function applyFilter(sourceCanvas, filterKind) {
  if (!sourceCanvas) return null

  // Fast path for 'original': clone source canvas
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const c = createCanvas(w, h)
  if (!c) return null
  const ctx = c.getContext('2d')
  ctx.drawImage(sourceCanvas, 0, 0)

  if (filterKind === 'original') {
    return c
  }

  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data

  switch (filterKind) {
    case 'magic_color':
      filterMagicColor(d, w, h)
      break
    case 'lighten':
      filterLighten(d)
      break
    case 'shadow_removal':
      filterShadowRemoval(d, w, h)
      break
    case 'bw':
      filterBlackAndWhite(d, w, h)
      break
    case 'grayscale':
      filterGrayscale(d)
      break
    default:
      filterMagicColor(d, w, h)
      break
  }

  ctx.putImageData(imgData, 0, 0)
  return c
}

/**
 * Asynchronous non-blocking wrapper for applyFilter.
 */
export async function applyFilterAsync(sourceCanvas, filterKind) {
  return new Promise(resolve => {
    // Break out of current microtask frame to prevent mobile UI hitching
    setTimeout(() => {
      resolve(applyFilter(sourceCanvas, filterKind))
    }, 0)
  })
}

/**
 * Generates small thumbnails for all filter presets from a source canvas.
 *
 * @param {HTMLCanvasElement | OffscreenCanvas} sourceCanvas
 * @param {number} thumbHeight
 * @returns {Record<string, string>} Map of filter ID to dataURL
 */
export function generateFilterThumbnails(sourceCanvas, thumbHeight = 90) {
  if (!sourceCanvas) return {}
  const aspect = sourceCanvas.width / (sourceCanvas.height || 1)
  const tw = Math.max(40, Math.round(thumbHeight * aspect))
  const th = thumbHeight

  const thumbBase = createCanvas(tw, th)
  if (!thumbBase) return {}
  const ctx = thumbBase.getContext('2d')
  ctx.drawImage(sourceCanvas, 0, 0, tw, th)

  const results = {}
  for (const preset of FILTER_PRESETS) {
    const filtered = applyFilter(thumbBase, preset.id)
    if (filtered && filtered.toDataURL) {
      results[preset.id] = filtered.toDataURL('image/jpeg', 0.85)
    }
  }
  return results
}
