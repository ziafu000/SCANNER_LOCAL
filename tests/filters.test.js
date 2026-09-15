import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FILTER_PRESETS,
  computeOtsuThreshold,
  filterMagicColor,
  filterShadowRemoval,
  filterBlackAndWhite,
  filterLighten,
  filterGrayscale
} from '../src/filters.js'

describe('Document Enhancement Filters', () => {
  it('defines all 6 expected filter presets', () => {
    const ids = FILTER_PRESETS.map(p => p.id)
    assert.deepStrictEqual(ids, [
      'original',
      'magic_color',
      'lighten',
      'shadow_removal',
      'bw',
      'grayscale'
    ])
    const labels = FILTER_PRESETS.map(p => p.label)
    assert.deepStrictEqual(labels, [
      'Bản gốc',
      'Tăng cường',
      'Làm sáng',
      'Không bóng',
      'Đen trắng',
      'Thang xám'
    ])
  })

  it('magic_color whitens grayish paper background and deepens dark text while preserving color', () => {
    // 4 pixels:
    // Pixel 0: gray paper (200, 200, 200) -> should be whitened closer to 255
    // Pixel 1: dark text (50, 50, 50) -> should remain dark or deepen
    // Pixel 2: red stamp (220, 40, 40) -> color saturation preserved/boosted
    // Pixel 3: white paper (245, 245, 245) -> whitened to near 255
    const pixels = new Uint8ClampedArray([
      200, 200, 200, 255,
      50, 50, 50, 255,
      220, 40, 40, 255,
      245, 245, 245, 255
    ])

    filterMagicColor(pixels, 2, 2)

    // Paper (Pixel 0) should be whiter than 200
    assert.ok(pixels[0] > 200, `Gray paper should whiten, got ${pixels[0]}`)
    // Dark text (Pixel 1) should remain dark (< 80)
    assert.ok(pixels[4] < 80, `Dark text should stay dark, got ${pixels[4]}`)
    // Red stamp (Pixel 2) should remain strongly red (R >> G and R >> B)
    assert.ok(pixels[8] > 180 && pixels[9] < 100, `Red stamp preserved: R=${pixels[8]}, G=${pixels[9]}`)
  })

  it('shadow_removal evens out illumination across shadowed gradient', () => {
    // 4x4 image with an artificial shadow gradient on white paper:
    // Left half is bright paper (220), right half has a phone shadow (110)
    const w = 8, h = 8
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const val = x < 4 ? 220 : 110 // Shadow on right side
        pixels[idx] = val
        pixels[idx + 1] = val
        pixels[idx + 2] = val
        pixels[idx + 3] = 255
      }
    }

    filterShadowRemoval(pixels, w, h)

    // After shadow removal, right side pixels should be lifted closer to left side
    const leftPixel = pixels[0]
    const rightPixel = pixels[(0 * w + 6) * 4]
    // The difference between left and right should be significantly reduced
    const diff = Math.abs(leftPixel - rightPixel)
    assert.ok(diff < 60, `Shadow gradient should be leveled: left=${leftPixel}, right=${rightPixel}, diff=${diff}`)
    assert.ok(rightPixel > 150, `Shadowed paper should be brightened: right=${rightPixel}`)
  })

  it('filterBlackAndWhite produces crisp binary output 0 or 255', () => {
    // 8x8 image with white background (230) and dark black text line in the middle (30)
    const w = 8, h = 8
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        // Line of text at y=4
        const val = (y === 4) ? 30 : 230
        pixels[idx] = val
        pixels[idx + 1] = val
        pixels[idx + 2] = val
        pixels[idx + 3] = 255
      }
    }

    filterBlackAndWhite(pixels, w, h)

    // Every pixel must be either 0 or 255
    for (let i = 0; i < pixels.length; i += 4) {
      assert.ok(pixels[i] === 0 || pixels[i] === 255, `Pixel should be binary 0 or 255, got ${pixels[i]}`)
      assert.strictEqual(pixels[i], pixels[i + 1])
      assert.strictEqual(pixels[i], pixels[i + 2])
    }

    // Text row (y=4) should be black (0)
    const textSample = pixels[(4 * w + 3) * 4]
    assert.strictEqual(textSample, 0, 'Text line should be black')

    // Background row (y=1) should be white (255)
    const bgSample = pixels[(1 * w + 3) * 4]
    assert.strictEqual(bgSample, 255, 'Background should be white')
  })

  it('filterLighten increases brightness', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 255])
    filterLighten(pixels)
    assert.ok(pixels[0] > 100)
  })

  it('filterGrayscale produces monochromatic RGB', () => {
    const pixels = new Uint8ClampedArray([255, 100, 50, 255])
    filterGrayscale(pixels)
    assert.strictEqual(pixels[0], pixels[1])
    assert.strictEqual(pixels[1], pixels[2])
  })

  it('computeOtsuThreshold finds optimal separation on bimodal distribution', () => {
    const gray = new Uint8Array(100)
    for (let i = 0; i < 50; i++) gray[i] = 40
    for (let i = 50; i < 100; i++) gray[i] = 220

    const thresh = computeOtsuThreshold(gray)
    assert.ok(thresh >= 40 && thresh < 220, `Threshold ${thresh} should be between 40 and 220`)
  })
})
