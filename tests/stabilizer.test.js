import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CornerStabilizer } from '../src/stabilizer.js'

describe('CornerStabilizer temporal smoothing & jitter filter', () => {
  it('initializes state on the first frame and returns initial coordinates', () => {
    const stabilizer = new CornerStabilizer()
    const initialCorners = [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 500 },
      { x: 100, y: 500 }
    ]

    const smoothed = stabilizer.update(initialCorners)
    assert.deepStrictEqual(smoothed, initialCorners)
    assert.deepStrictEqual(stabilizer.getLastCorners(), initialCorners)
  })

  it('suppresses jitter on stationary document using low alpha EMA smoothing', () => {
    const stabilizer = new CornerStabilizer({ minAlpha: 0.2, lowDelta: 5 })
    const baseCorners = [
      { x: 200, y: 150 },
      { x: 600, y: 150 },
      { x: 600, y: 700 },
      { x: 200, y: 700 }
    ]

    stabilizer.update(baseCorners)

    // Simulate 20 frames of camera sensor jitter (+- 1 to 2 px)
    const jitterOffsets = [
      { dx: 1.5, dy: -1.2 },
      { dx: -1.8, dy: 1.4 },
      { dx: 0.8, dy: -1.5 },
      { dx: -1.2, dy: -0.9 },
      { dx: 1.9, dy: 1.1 },
      { dx: -0.5, dy: 1.8 }
    ]

    let maxRawJitter = 0
    let maxSmoothedJitter = 0

    for (let i = 0; i < jitterOffsets.length; i++) {
      const { dx, dy } = jitterOffsets[i]
      const raw = baseCorners.map(p => ({ x: p.x + dx, y: p.y + dy }))
      const smoothed = stabilizer.update(raw)

      const rawDev = Math.hypot(raw[0].x - baseCorners[0].x, raw[0].y - baseCorners[0].y)
      const smoothedDev = Math.hypot(smoothed[0].x - baseCorners[0].x, smoothed[0].y - baseCorners[0].y)

      maxRawJitter = Math.max(maxRawJitter, rawDev)
      maxSmoothedJitter = Math.max(maxSmoothedJitter, smoothedDev)
    }

    // Smoothed displacement deviation must be substantially smaller than raw jitter
    assert.ok(maxSmoothedJitter < maxRawJitter * 0.65, `Expected jitter dampening, smoothed=${maxSmoothedJitter}, raw=${maxRawJitter}`)
  })

  it('dynamically increases alpha during fast camera panning for zero-lag tracking', () => {
    const stabilizer = new CornerStabilizer({ minAlpha: 0.2, maxAlpha: 0.85, highDelta: 35 })
    const initialCorners = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 400 },
      { x: 100, y: 400 }
    ]

    stabilizer.update(initialCorners)

    // Rapid camera pan: moves 50px along X
    const fastMovedCorners = initialCorners.map(p => ({ x: p.x + 50, y: p.y }))
    const smoothed = stabilizer.update(fastMovedCorners)

    // With alpha >= 0.85, smoothed corner should reach at least 42.5px of the 50px jump in 1 frame
    const deltaX = smoothed[0].x - initialCorners[0].x
    assert.ok(deltaX >= 40, `Expected fast response (deltaX >= 40), got ${deltaX}`)
  })

  it('snaps immediately without lag on teleportation / scene change (delta > snapDelta)', () => {
    const stabilizer = new CornerStabilizer({ snapDelta: 100 })
    const docA = [
      { x: 50, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 350 },
      { x: 50, y: 350 }
    ]
    const docB = [
      { x: 400, y: 500 },
      { x: 700, y: 500 },
      { x: 700, y: 900 },
      { x: 400, y: 900 }
    ]

    stabilizer.update(docA)
    // Document changes completely (total delta across 4 corners > 1000px)
    const snapped = stabilizer.update(docB)

    assert.deepStrictEqual(snapped, docB, 'Should snap immediately to new coordinates')
  })

  it('resets state properly via reset()', () => {
    const stabilizer = new CornerStabilizer()
    const corners = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 80 },
      { x: 10, y: 80 }
    ]

    stabilizer.update(corners)
    assert.notStrictEqual(stabilizer.getLastCorners(), null)

    stabilizer.reset()
    assert.strictEqual(stabilizer.getLastCorners(), null)

    const newCorners = [
      { x: 200, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 500 },
      { x: 200, y: 500 }
    ]
    const updated = stabilizer.update(newCorners)
    assert.deepStrictEqual(updated, newCorners)
  })

  it('gracefully handles null or invalid inputs', () => {
    const stabilizer = new CornerStabilizer()
    assert.strictEqual(stabilizer.update(null), null)
    assert.strictEqual(stabilizer.update([]), null)
    assert.strictEqual(stabilizer.update([{ x: 0, y: 0 }]), null)
  })
})
