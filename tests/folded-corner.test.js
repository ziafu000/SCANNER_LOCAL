import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isReasonableQuad,
  orderPoints,
  lineIntersection,
  recoverFoldedCorners
} from '../src/geometry.js'

function isPointInPolygon(pt, polygon) {
  if (!polygon || polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x <= (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

describe('Folded corner tracking & recovery', () => {
  it('demonstrates that raw 5-gon without inferred corners cuts into document content', () => {
    // True document A4 rectangle: (100, 100) to (700, 900)
    // Top-right corner (700, 100) is folded with crease from (620, 100) to (700, 180)
    const foldedPentagon = [
      { x: 100, y: 100 }, // Top-Left
      { x: 620, y: 100 }, // Fold start on top edge
      { x: 700, y: 180 }, // Fold end on right edge
      { x: 700, y: 900 }, // Bottom-Right
      { x: 100, y: 900 }  // Bottom-Left
    ]

    // Point in document header near top-right corner that would contain text
    const headerTextPoint = { x: 660, y: 120 }

    // If we naively drop fold vertex to get a 4-gon (old behavior):
    const naiveClippedQuad = [
      { x: 100, y: 100 },
      { x: 700, y: 180 },
      { x: 700, y: 900 },
      { x: 100, y: 900 }
    ]

    // The naive clipped quad excludes the document header (cuts off content)
    assert.strictEqual(
      isPointInPolygon(headerTextPoint, naiveClippedQuad),
      false,
      'Naive quad cuts into document content'
    )
  })

  it('calculates line intersection correctly', () => {
    const p1 = { x: 100, y: 100 }
    const p2 = { x: 600, y: 100 } // Horizontal line at y=100
    const p3 = { x: 700, y: 200 }
    const p4 = { x: 700, y: 900 } // Vertical line at x=700

    const pt = lineIntersection(p1, p2, p3, p4)
    assert.ok(pt)
    assert.strictEqual(Math.round(pt.x), 700)
    assert.strictEqual(Math.round(pt.y), 100)
  })

  it('recovers top-right folded corner via line intersection', () => {
    const foldedPentagon = [
      { x: 100, y: 100 }, // Top-Left
      { x: 620, y: 100 }, // Fold start
      { x: 700, y: 180 }, // Fold end
      { x: 700, y: 900 }, // Bottom-Right
      { x: 100, y: 900 }  // Bottom-Left
    ]

    const recovered = recoverFoldedCorners(foldedPentagon)
    assert.ok(recovered, 'Should recover 4 corners')
    assert.strictEqual(recovered.length, 4)

    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(tl.x), 100)
    assert.strictEqual(Math.round(tl.y), 100)
    assert.strictEqual(Math.round(tr.x), 700, 'Top-right X recovered')
    assert.strictEqual(Math.round(tr.y), 100, 'Top-right Y recovered')
    assert.strictEqual(Math.round(br.x), 700)
    assert.strictEqual(Math.round(br.y), 900)
    assert.strictEqual(Math.round(bl.x), 100)
    assert.strictEqual(Math.round(bl.y), 900)

    // Verify document content is NOT cut off
    const headerTextPoint = { x: 660, y: 120 }
    assert.strictEqual(
      isPointInPolygon(headerTextPoint, recovered),
      true,
      'Document text must be inside recovered quad'
    )
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers top-left folded corner', () => {
    const foldedPentagon = [
      { x: 100, y: 180 }, // Fold start on left edge
      { x: 180, y: 100 }, // Fold end on top edge
      { x: 700, y: 100 }, // Top-Right
      { x: 700, y: 900 }, // Bottom-Right
      { x: 100, y: 900 }  // Bottom-Left
    ]

    const recovered = recoverFoldedCorners(foldedPentagon)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(tl.x), 100, 'Top-left X recovered')
    assert.strictEqual(Math.round(tl.y), 100, 'Top-left Y recovered')
    assert.strictEqual(Math.round(tr.x), 700)
    assert.strictEqual(Math.round(tr.y), 100)
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers bottom-right folded corner', () => {
    const foldedPentagon = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 820 }, // Fold start on right
      { x: 620, y: 900 }, // Fold end on bottom
      { x: 100, y: 900 }
    ]

    const recovered = recoverFoldedCorners(foldedPentagon)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(br.x), 700, 'Bottom-right X recovered')
    assert.strictEqual(Math.round(br.y), 900, 'Bottom-right Y recovered')
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers bottom-left folded corner', () => {
    const foldedPentagon = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 900 },
      { x: 180, y: 900 }, // Fold start on bottom
      { x: 100, y: 820 }  // Fold end on left
    ]

    const recovered = recoverFoldedCorners(foldedPentagon)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(bl.x), 100, 'Bottom-left X recovered')
    assert.strictEqual(Math.round(bl.y), 900, 'Bottom-left Y recovered')
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers perspective-skewed document with folded corner', () => {
    // Skewed camera perspective quad:
    // tl: (120, 100), tr: (380, 110), br: (410, 480), bl: (90, 470)
    // tr corner folded between: (340, 108) on top edge and (385, 170) on right edge
    const foldedSkewed = [
      { x: 120, y: 100 },
      { x: 340, y: 108.46 },
      { x: 384.86, y: 170 },
      { x: 410, y: 480 },
      { x: 90, y: 470 }
    ]

    const recovered = recoverFoldedCorners(foldedSkewed)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    // TR intersection should be very close to (380, 110)
    assert.ok(Math.abs(tr.x - 380) < 3, `TR x should be near 380, got ${tr.x}`)
    assert.ok(Math.abs(tr.y - 110) < 3, `TR y should be near 110, got ${tr.y}`)
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('preserves standard 4-corner document without modification', () => {
    const standardQuad = [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 500 },
      { x: 100, y: 500 }
    ]

    const result = recoverFoldedCorners(standardQuad)
    assert.ok(result)
    assert.strictEqual(result.length, 4)
    assert.deepStrictEqual(result, standardQuad)
  })
})
