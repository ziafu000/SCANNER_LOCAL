import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  recoverOccludedQuad,
  isReasonableQuad,
  orderPoints
} from '../src/geometry.js'

describe('recoverOccludedQuad smart line fitting & hand occlusion recovery', () => {
  it('recovers 4 geometric corners when finger occludes right edge (7-gon)', () => {
    // True document rectangle: (100, 100) to (500, 700)
    // Finger holding right edge at y=400 creates an inward protrusion
    const occludedDoc = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 350 },
      { x: 440, y: 400 }, // finger notch
      { x: 500, y: 450 },
      { x: 500, y: 700 },
      { x: 100, y: 700 }
    ]

    const recovered = recoverOccludedQuad(occludedDoc)
    assert.ok(recovered, 'Should recover 4 corners')
    assert.strictEqual(recovered.length, 4)

    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(tl.x), 100)
    assert.strictEqual(Math.round(tl.y), 100)
    assert.strictEqual(Math.round(tr.x), 500)
    assert.strictEqual(Math.round(tr.y), 100)
    assert.strictEqual(Math.round(br.x), 500)
    assert.strictEqual(Math.round(br.y), 700)
    assert.strictEqual(Math.round(bl.x), 100)
    assert.strictEqual(Math.round(bl.y), 700)
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers 4 corners when multiple fingers occlude top and bottom edges (8-gon)', () => {
    // True document: (100, 100) to (600, 800)
    const multiOccluded = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 320, y: 140 }, // finger on top edge
      { x: 340, y: 100 },
      { x: 600, y: 100 },
      { x: 600, y: 800 },
      { x: 250, y: 800 },
      { x: 230, y: 760 }, // finger on bottom edge
      { x: 210, y: 800 },
      { x: 100, y: 800 }
    ]

    const recovered = recoverOccludedQuad(multiOccluded)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    assert.strictEqual(Math.round(tl.x), 100)
    assert.strictEqual(Math.round(tl.y), 100)
    assert.strictEqual(Math.round(tr.x), 600)
    assert.strictEqual(Math.round(tr.y), 100)
    assert.strictEqual(Math.round(br.x), 600)
    assert.strictEqual(Math.round(br.y), 800)
    assert.strictEqual(Math.round(bl.x), 100)
    assert.strictEqual(Math.round(bl.y), 800)
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('recovers perspective-skewed document with hand occlusion', () => {
    // Skewed quad: tl(120, 100), tr(420, 110), br(450, 480), bl(90, 470)
    const tiltedOccluded = [
      { x: 120, y: 100 },
      { x: 260, y: 105 },
      { x: 270, y: 135 }, // top finger
      { x: 290, y: 105 },
      { x: 420, y: 110 },
      { x: 450, y: 480 },
      { x: 90, y: 470 }
    ]

    const recovered = recoverOccludedQuad(tiltedOccluded)
    assert.ok(recovered)
    const [tl, tr, br, bl] = recovered
    assert.ok(Math.abs(tl.x - 120) < 2)
    assert.ok(Math.abs(tr.x - 420) < 3)
    assert.ok(Math.abs(br.x - 450) < 2)
    assert.ok(Math.abs(bl.x - 90) < 2)
    assert.strictEqual(isReasonableQuad(recovered), true)
  })

  it('returns null for polygons with too few or too many vertices', () => {
    assert.strictEqual(recoverOccludedQuad(null), null)
    assert.strictEqual(recoverOccludedQuad([]), null)
    assert.strictEqual(recoverOccludedQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), null)
  })
})
