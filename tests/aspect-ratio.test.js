import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeTrueAspectRatio,
  snapToStandardPaper,
  computeWarpDimensions,
  STANDARD_PAPER_RATIOS
} from '../src/aspect-ratio.js'

describe('True Aspect Ratio Recovery & Paper Standard Snapping', () => {
  describe('computeTrueAspectRatio 3D geometry engine', () => {
    it('accurately recovers flat A4 portrait aspect ratio (210 / 297 ~ 0.7071)', () => {
      const flatA4 = [
        { x: 400, y: 200 },
        { x: 820, y: 200 },
        { x: 820, y: 794 },
        { x: 400, y: 794 }
      ]
      const ar = computeTrueAspectRatio(flatA4, 1920, 1440)
      assert.ok(Math.abs(ar - 210 / 297) < 0.01, `Expected ~0.7071, got ${ar}`)
    })

    it('accurately recovers flat A4 landscape aspect ratio (297 / 210 ~ 1.4142)', () => {
      const flatA4Landscape = [
        { x: 200, y: 300 },
        { x: 794, y: 300 },
        { x: 794, y: 720 },
        { x: 200, y: 720 }
      ]
      const ar = computeTrueAspectRatio(flatA4Landscape, 1920, 1440)
      assert.ok(Math.abs(ar - 297 / 210) < 0.01, `Expected ~1.4142, got ${ar}`)
    })

    it('recovers true 3D aspect ratio for an A4 document tilted at 30 degrees (pitch)', () => {
      // Ground truth 3D A4 rectangle: 210 x 297 mm at distance Z=1200, pitch=30 deg
      const f = 1500
      const Z = 1200
      const pitch = (30 * Math.PI) / 180
      const W3D = 210
      const H3D = 297
      const cx = 960
      const cy = 720

      const c3D = [
        { X: -W3D / 2, Y: -H3D / 2 * Math.cos(pitch), Z: Z - H3D / 2 * Math.sin(pitch) },
        { X:  W3D / 2, Y: -H3D / 2 * Math.cos(pitch), Z: Z - H3D / 2 * Math.sin(pitch) },
        { X:  W3D / 2, Y:  H3D / 2 * Math.cos(pitch), Z: Z + H3D / 2 * Math.sin(pitch) },
        { X: -W3D / 2, Y:  H3D / 2 * Math.cos(pitch), Z: Z + H3D / 2 * Math.sin(pitch) }
      ]

      const tiltedA4 = c3D.map(p => ({
        x: cx + (f * p.X) / p.Z,
        y: cy + (f * p.Y) / p.Z
      }))

      // Naive 2D bounding box would give foreshortened distorted ratio
      const naiveRatio = ((Math.hypot(tiltedA4[1].x - tiltedA4[0].x, tiltedA4[1].y - tiltedA4[0].y) +
                           Math.hypot(tiltedA4[2].x - tiltedA4[3].x, tiltedA4[2].y - tiltedA4[3].y)) / 2) /
                         ((Math.hypot(tiltedA4[3].x - tiltedA4[0].x, tiltedA4[3].y - tiltedA4[0].y) +
                           Math.hypot(tiltedA4[2].x - tiltedA4[1].x, tiltedA4[2].y - tiltedA4[1].y)) / 2)

      const recoveredAR = computeTrueAspectRatio(tiltedA4, 1920, 1440, f)

      // Naive 2D ratio is distorted by ~17%
      assert.ok(Math.abs(naiveRatio - 210 / 297) > 0.10, 'Naive 2D ratio should exhibit perspective foreshortening')
      // Sturm/Triggs projective formulation recovers true aspect ratio within 2%
      assert.ok(Math.abs(recoveredAR - 210 / 297) < 0.02, `Expected ~0.7071, got ${recoveredAR}`)
    })

    it('recovers true 3D aspect ratio for an A4 document with multi-axis tilt (pitch 35 deg, yaw 20 deg)', () => {
      const f = 1550
      const Z = 1200
      const pitch = (35 * Math.PI) / 180
      const yaw = (20 * Math.PI) / 180
      const W3D = 210
      const H3D = 297
      const cx = 960
      const cy = 720

      function rotate3D(x, y, z) {
        // yaw around Y
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
        const y1 = y
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
        // pitch around X
        const x2 = x1
        const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch)
        const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch)
        return { X: x2, Y: y2, Z: z2 + Z }
      }

      const c3D = [
        rotate3D(-W3D / 2, -H3D / 2, 0),
        rotate3D( W3D / 2, -H3D / 2, 0),
        rotate3D( W3D / 2,  H3D / 2, 0),
        rotate3D(-W3D / 2,  H3D / 2, 0)
      ]

      const multiTilted = c3D.map(p => ({
        x: cx + (f * p.X) / p.Z,
        y: cy + (f * p.Y) / p.Z
      }))

      const recoveredAR = computeTrueAspectRatio(multiTilted, 1920, 1440, f)
      assert.ok(Math.abs(recoveredAR - 210 / 297) < 0.03, `Expected ~0.7071, got ${recoveredAR}`)
    })

    it('gracefully handles invalid / degenerate / null corners', () => {
      assert.strictEqual(computeTrueAspectRatio(null), 1.0)
      assert.strictEqual(computeTrueAspectRatio([]), 1.0)
      assert.strictEqual(computeTrueAspectRatio([{ x: 0, y: 0 }]), 1.0)
    })
  })

  describe('snapToStandardPaper', () => {
    it('snaps portrait A-Series (A4/A5/A3) within ±8% tolerance', () => {
      // True 1 / sqrt(2) ~ 0.707106
      const resultExact = snapToStandardPaper(0.7071)
      assert.strictEqual(resultExact.isSnapped, true)
      assert.strictEqual(resultExact.standard, 'a_series')
      assert.ok(Math.abs(resultExact.ratio - 1 / Math.SQRT2) < 1e-6)

      // Near upper bound (0.75 -> 1/0.75 = 1.333, within 8% of 1.414)
      const resultPerturbed = snapToStandardPaper(0.73)
      assert.strictEqual(resultPerturbed.isSnapped, true)
      assert.strictEqual(resultPerturbed.standard, 'a_series')
    })

    it('snaps landscape A-Series (A4/A5/A3) within ±8% tolerance', () => {
      const resultLandscape = snapToStandardPaper(1.42)
      assert.strictEqual(resultLandscape.isSnapped, true)
      assert.strictEqual(resultLandscape.standard, 'a_series')
      assert.ok(Math.abs(resultLandscape.ratio - Math.SQRT2) < 1e-6)
    })

    it('snaps US Letter (8.5 x 11 inches) within ±5% tolerance', () => {
      // 8.5 / 11 ~ 0.7727
      const resultPortrait = snapToStandardPaper(0.77)
      assert.strictEqual(resultPortrait.isSnapped, true)
      assert.strictEqual(resultPortrait.standard, 'us_letter')
      assert.ok(Math.abs(resultPortrait.ratio - 8.5 / 11) < 1e-6)

      // 11 / 8.5 ~ 1.2941
      const resultLandscape = snapToStandardPaper(1.29)
      assert.strictEqual(resultLandscape.isSnapped, true)
      assert.strictEqual(resultLandscape.standard, 'us_letter')
      assert.ok(Math.abs(resultLandscape.ratio - 11 / 8.5) < 1e-6)
    })

    it('snaps US Legal (8.5 x 14 inches) within ±5% tolerance', () => {
      const resultLegal = snapToStandardPaper(1.54)
      assert.strictEqual(resultLegal.isSnapped, true)
      assert.strictEqual(resultLegal.standard, 'us_legal')
    })

    it('snaps ID Card / Bank Card (85.60 x 53.98 mm) within ±5% tolerance', () => {
      // 85.60 / 53.98 ~ 1.58577
      const resultID = snapToStandardPaper(1.58)
      assert.strictEqual(resultID.isSnapped, true)
      assert.strictEqual(resultID.standard, 'id_card')
      assert.ok(Math.abs(resultID.ratio - 85.6 / 53.98) < 1e-4)
    })

    it('snaps Business Card (90 x 50 mm / 1.75 ratio) within ±5% tolerance', () => {
      const resultBiz = snapToStandardPaper(1.74)
      assert.strictEqual(resultBiz.isSnapped, true)
      assert.strictEqual(resultBiz.standard, 'business_card')
      assert.strictEqual(resultBiz.ratio, 1.75)
    })

    it('retains free/custom aspect ratio for non-standard documents (receipts, squares)', () => {
      // Long grocery receipt (1 : 3.2)
      const receipt = snapToStandardPaper(1 / 3.2)
      assert.strictEqual(receipt.isSnapped, false)
      assert.strictEqual(receipt.standard, 'custom')
      assert.ok(Math.abs(receipt.ratio - 1 / 3.2) < 1e-6)

      // Perfect square (1 : 1)
      const square = snapToStandardPaper(1.0)
      assert.strictEqual(square.isSnapped, false)
      assert.strictEqual(square.standard, 'custom')
      assert.strictEqual(square.ratio, 1.0)
    })

    it('safely handles non-finite / zero / negative aspect ratios', () => {
      assert.strictEqual(snapToStandardPaper(0).ratio, 1.0)
      assert.strictEqual(snapToStandardPaper(-1).ratio, 1.0)
      assert.strictEqual(snapToStandardPaper(NaN).ratio, 1.0)
      assert.strictEqual(snapToStandardPaper(Infinity).ratio, 1.0)
    })
  })

  describe('computeWarpDimensions output resolution calculator', () => {
    it('computes correct output canvas dimensions for A4 portrait document without distortion', () => {
      const a4Corners = [
        { x: 200, y: 100 },
        { x: 624, y: 100 }, // width ~424
        { x: 624, y: 700 }, // height ~600
        { x: 200, y: 700 }
      ]

      const dims = computeWarpDimensions(a4Corners, 1920, 1440)
      assert.strictEqual(dims.isSnapped, true)
      assert.strictEqual(dims.standard, 'a_series')
      // Width / Height must equal snapped 1 / sqrt(2)
      const computedRatio = dims.width / dims.height
      assert.ok(Math.abs(computedRatio - 1 / Math.SQRT2) < 0.01)
      assert.ok(dims.width >= 400 && dims.height >= 550)
    })

    it('computes correct output canvas dimensions for ID card landscape document', () => {
      const idCorners = [
        { x: 100, y: 100 },
        { x: 417, y: 100 }, // width ~317
        { x: 417, y: 300 }, // height ~200 -> 317/200 ~ 1.585
        { x: 100, y: 300 }
      ]

      const dims = computeWarpDimensions(idCorners, 1920, 1440)
      assert.strictEqual(dims.isSnapped, true)
      assert.strictEqual(dims.standard, 'id_card')
      const computedRatio = dims.width / dims.height
      assert.ok(Math.abs(computedRatio - 85.6 / 53.98) < 0.01)
    })

    it('maintains high resolution for tilted captures without shrinking', () => {
      const tiltedQuad = [
        { x: 300, y: 150 },
        { x: 800, y: 170 },
        { x: 860, y: 900 },
        { x: 240, y: 880 }
      ]

      const dims = computeWarpDimensions(tiltedQuad, 1920, 1440)
      assert.ok(dims.width > 500)
      assert.ok(dims.height > 700)
      assert.ok(dims.width <= 1920 && dims.height <= 1920)
    })
  })
})
