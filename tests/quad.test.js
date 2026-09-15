import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isReasonableQuad, orderPoints } from '../src/geometry.js'

describe('isReasonableQuad geometric validation', () => {
  it('accepts a valid standard rectangle (A4 portrait)', () => {
    // 210 x 297 ratio
    const quad = [
      { x: 100, y: 100 },
      { x: 310, y: 100 },
      { x: 310, y: 397 },
      { x: 100, y: 397 }
    ]
    assert.strictEqual(isReasonableQuad(quad), true)
  })

  it('accepts a valid perspective-skewed document with angles between 65 and 115 degrees', () => {
    // Mild perspective tilt
    const quad = [
      { x: 120, y: 100 },
      { x: 380, y: 110 },
      { x: 410, y: 480 },
      { x: 90, y: 470 }
    ]
    assert.strictEqual(isReasonableQuad(quad), true)
  })

  it('rejects quadrilaterals with acute or obtuse angles outside 65-115 degrees (e.g. background noise / rhomboids)', () => {
    // Sharp angle quad (e.g. 45 degrees)
    const sharpQuad = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 400, y: 200 },
      { x: 100, y: 200 }
    ]
    // Corner at tl or tr:
    // tl: (100, 200) -> (100, 100) -> (300, 100) is 90 deg
    // tr: (100, 100) -> (300, 100) -> (400, 200) is 135 deg (|cos| = 0.707 > 0.42)
    assert.strictEqual(isReasonableQuad(sharpQuad), false)
  })

  it('rejects extreme trapezoids where widthRatio < 0.55', () => {
    // Top width = 50, Bottom width = 200 -> widthRatio = 0.25 < 0.55
    const quad = [
      { x: 175, y: 100 },
      { x: 225, y: 100 },
      { x: 300, y: 400 },
      { x: 100, y: 400 }
    ]
    assert.strictEqual(isReasonableQuad(quad), false)
  })

  it('rejects extreme trapezoids where heightRatio < 0.55', () => {
    // Left height = 60, Right height = 200 -> heightRatio = 0.3 < 0.55
    const quad = [
      { x: 100, y: 140 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 200 }
    ]
    assert.strictEqual(isReasonableQuad(quad), false)
  })

  it('rejects shapes with aspect ratio outside 0.3 to 3.5 (e.g. keyboard strip)', () => {
    // Very thin banner: width = 400, height = 30 -> ar = 13.3 > 3.5
    const thinQuad = [
      { x: 50, y: 100 },
      { x: 450, y: 100 },
      { x: 450, y: 130 },
      { x: 50, y: 130 }
    ]
    assert.strictEqual(isReasonableQuad(thinQuad), false)

    // Very tall strip: width = 30, height = 400 -> ar = 0.075 < 0.3
    const tallQuad = [
      { x: 100, y: 50 },
      { x: 130, y: 50 },
      { x: 130, y: 450 },
      { x: 100, y: 450 }
    ]
    assert.strictEqual(isReasonableQuad(tallQuad), false)
  })

  it('rejects too small quadrilaterals (edge < 15px)', () => {
    const tinyQuad = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 }
    ]
    assert.strictEqual(isReasonableQuad(tinyQuad), false)
  })

  it('rejects null or invalid number of points', () => {
    assert.strictEqual(isReasonableQuad(null), false)
    assert.strictEqual(isReasonableQuad([]), false)
    assert.strictEqual(isReasonableQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), false)
  })
})

describe('orderPoints helper', () => {
  it('consistently orders points into [tl, tr, br, bl]', () => {
    const unordered = [
      { x: 300, y: 300 }, // br
      { x: 100, y: 100 }, // tl
      { x: 100, y: 300 }, // bl
      { x: 300, y: 100 }  // tr
    ]
    const ordered = orderPoints(unordered)
    assert.deepStrictEqual(ordered[0], { x: 100, y: 100 }, 'tl')
    assert.deepStrictEqual(ordered[1], { x: 300, y: 100 }, 'tr')
    assert.deepStrictEqual(ordered[2], { x: 300, y: 300 }, 'br')
    assert.deepStrictEqual(ordered[3], { x: 100, y: 300 }, 'bl')
  })
})
