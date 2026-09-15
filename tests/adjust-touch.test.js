import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  extractClientCoords,
  calculateClampedPoint,
  updateCornerPoint,
  getSvgPolygonPoints
} from '../src/adjust-helper.js'
import ErrorBoundary from '../src/ErrorBoundary.js'

describe('extractClientCoords safe touch & pointer coordinate extraction', () => {
  it('extracts coordinates from touchstart / touchmove (e.touches)', () => {
    const event = {
      touches: [{ clientX: 154.5, clientY: 280.2 }]
    }
    const coords = extractClientCoords(event)
    assert.deepStrictEqual(coords, { clientX: 154.5, clientY: 280.2 })
  })

  it('extracts coordinates from touchend / touchcancel (e.changedTouches)', () => {
    const event = {
      touches: [],
      changedTouches: [{ clientX: 88, clientY: 190 }]
    }
    const coords = extractClientCoords(event)
    assert.deepStrictEqual(coords, { clientX: 88, clientY: 190 })
  })

  it('extracts coordinates from standard PointerEvent / MouseEvent', () => {
    const event = {
      clientX: 320,
      clientY: 480
    }
    const coords = extractClientCoords(event)
    assert.deepStrictEqual(coords, { clientX: 320, clientY: 480 })
  })

  it('rejects null, undefined, empty, or invalid event objects', () => {
    assert.strictEqual(extractClientCoords(null), null)
    assert.strictEqual(extractClientCoords(undefined), null)
    assert.strictEqual(extractClientCoords({}), null)
    assert.strictEqual(extractClientCoords({ touches: [] }), null)
    assert.strictEqual(extractClientCoords({ changedTouches: [] }), null)
  })

  it('rejects events containing NaN, null, undefined, or Infinity coordinates', () => {
    assert.strictEqual(extractClientCoords({ clientX: NaN, clientY: 100 }), null)
    assert.strictEqual(extractClientCoords({ clientX: 100, clientY: Infinity }), null)
    assert.strictEqual(extractClientCoords({ clientX: null, clientY: 100 }), null)
    assert.strictEqual(extractClientCoords({ touches: [{ clientX: NaN, clientY: 50 }] }), null)
    assert.strictEqual(extractClientCoords({ touches: [{ clientX: undefined, clientY: 50 }] }), null)
    assert.strictEqual(extractClientCoords({ changedTouches: [{ clientX: 'string', clientY: 50 }] }), null)
  })
})

describe('calculateClampedPoint bounds constraint & scaling', () => {
  const rect = { left: 50, top: 100, width: 300, height: 400 }
  const imageSize = { width: 1200, height: 1600 }

  it('correctly maps coordinates inside bounding box to image pixels', () => {
    // Middle of the bounding box: (50 + 150, 100 + 200) -> norm (0.5, 0.5) -> (600, 800)
    const coords = { clientX: 200, clientY: 300 }
    const pt = calculateClampedPoint(coords, rect, imageSize)
    assert.deepStrictEqual(pt, { x: 600, y: 800 })
  })

  it('correctly maps origin (top-left) and opposite corner (bottom-right)', () => {
    const topLeft = calculateClampedPoint({ clientX: 50, clientY: 100 }, rect, imageSize)
    assert.deepStrictEqual(topLeft, { x: 0, y: 0 })

    const bottomRight = calculateClampedPoint({ clientX: 350, clientY: 500 }, rect, imageSize)
    assert.deepStrictEqual(bottomRight, { x: 1200, y: 1600 })
  })

  it('clamps coordinates dragged outside bounding box (left/top negative, right/bottom overflow)', () => {
    // Dragged far off to top-left
    const outsideTopLeft = calculateClampedPoint({ clientX: -100, clientY: -50 }, rect, imageSize)
    assert.deepStrictEqual(outsideTopLeft, { x: 0, y: 0 })

    // Dragged far off to bottom-right
    const outsideBottomRight = calculateClampedPoint({ clientX: 999, clientY: 999 }, rect, imageSize)
    assert.deepStrictEqual(outsideBottomRight, { x: 1200, y: 1600 })

    // Dragged partially out on X only
    const partialX = calculateClampedPoint({ clientX: 500, clientY: 200 }, rect, imageSize)
    assert.deepStrictEqual(partialX, { x: 1200, y: 400 })
  })

  it('rejects invalid or zero bounding rect dimensions', () => {
    const zeroRect = { left: 0, top: 0, width: 0, height: 0 }
    assert.strictEqual(calculateClampedPoint({ clientX: 10, clientY: 10 }, zeroRect, imageSize), null)

    const negativeRect = { left: 0, top: 0, width: -100, height: 200 }
    assert.strictEqual(calculateClampedPoint({ clientX: 10, clientY: 10 }, negativeRect, imageSize), null)
  })

  it('rejects invalid or zero image dimensions', () => {
    const zeroImg = { width: 0, height: 0 }
    assert.strictEqual(calculateClampedPoint({ clientX: 100, clientY: 150 }, rect, zeroImg), null)
  })

  it('rejects non-finite coordinate or geometry inputs', () => {
    assert.strictEqual(calculateClampedPoint(null, rect, imageSize), null)
    assert.strictEqual(calculateClampedPoint({ clientX: NaN, clientY: 100 }, rect, imageSize), null)
    assert.strictEqual(calculateClampedPoint({ clientX: 100, clientY: 100 }, { ...rect, width: NaN }, imageSize), null)
    assert.strictEqual(calculateClampedPoint({ clientX: 100, clientY: 100 }, rect, { width: NaN, height: 100 }), null)
  })
})

describe('updateCornerPoint safe 4-point quad updates', () => {
  const initialPoints = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 }
  ]

  it('updates specific point at valid index and immutably returns new array', () => {
    const updated = updateCornerPoint(initialPoints, 1, { x: 95, y: 15 })
    assert.deepStrictEqual(updated[1], { x: 95, y: 15 })
    assert.deepStrictEqual(updated[0], { x: 10, y: 10 })
    assert.deepStrictEqual(updated[2], { x: 90, y: 90 })
    assert.deepStrictEqual(updated[3], { x: 10, y: 90 })
    assert.notStrictEqual(updated, initialPoints)
  })

  it('ignores out-of-range index without mutating array', () => {
    const outOfBoundsNeg = updateCornerPoint(initialPoints, -1, { x: 50, y: 50 })
    assert.deepStrictEqual(outOfBoundsNeg, initialPoints)

    const outOfBoundsPos = updateCornerPoint(initialPoints, 4, { x: 50, y: 50 })
    assert.deepStrictEqual(outOfBoundsPos, initialPoints)
  })

  it('ignores update if new point is null, undefined, or has NaN coordinates', () => {
    assert.deepStrictEqual(updateCornerPoint(initialPoints, 0, null), initialPoints)
    assert.deepStrictEqual(updateCornerPoint(initialPoints, 0, { x: NaN, y: 20 }), initialPoints)
    assert.deepStrictEqual(updateCornerPoint(initialPoints, 0, { x: 20, y: NaN }), initialPoints)
    assert.deepStrictEqual(updateCornerPoint(initialPoints, 0, { x: Infinity, y: 20 }), initialPoints)
  })
})

describe('getSvgPolygonPoints helper', () => {
  const points = [
    { x: 100, y: 120 },
    { x: 800, y: 130 },
    { x: 790, y: 950 },
    { x: 110, y: 940 }
  ]
  const imageSize = { width: 900, height: 1000 }

  it('generates valid SVG polygon points string', () => {
    const svgStr = getSvgPolygonPoints(points, imageSize)
    assert.strictEqual(svgStr, '100,120 800,130 790,950 110,940')
  })

  it('returns empty string on invalid inputs or NaN points', () => {
    assert.strictEqual(getSvgPolygonPoints(null, imageSize), '')
    assert.strictEqual(getSvgPolygonPoints([], imageSize), '')
    assert.strictEqual(getSvgPolygonPoints(points, null), '')
    assert.strictEqual(getSvgPolygonPoints(points, { width: 0, height: 1000 }), '')

    const corruptPoints = [
      { x: 100, y: 120 },
      { x: NaN, y: 130 },
      { x: 790, y: 950 },
      { x: 110, y: 940 }
    ]
    assert.strictEqual(getSvgPolygonPoints(corruptPoints, imageSize), '')
  })
})

describe('ErrorBoundary component', () => {
  it('renders children when no error occurs', () => {
    const html = renderToString(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement('div', { id: 'child' }, 'Normal UI')
      )
    )
    assert.match(html, /Normal UI/)
  })

  it('renders fallback UI with retry action when error state is active', () => {
    const errorBoundary = new ErrorBoundary({})
    errorBoundary.state = { hasError: true, error: new Error('Simulated crash') }
    const rendered = errorBoundary.render()
    const html = renderToString(rendered)

    assert.match(html, /Đã xảy ra sự cố hiển thị/)
    assert.match(html, /Thử lại/)
  })

  it('renders custom fallback if provided', () => {
    const customFallback = ({ error }) => React.createElement('div', null, `Custom: ${error.message}`)
    const errorBoundary = new ErrorBoundary({ fallback: customFallback })
    errorBoundary.state = { hasError: true, error: new Error('Custom error') }
    const rendered = errorBoundary.render()
    const html = renderToString(rendered)

    assert.match(html, /Custom: Custom error/)
  })

  it('handleReset resets error state and calls onReset callback', () => {
    let resetCalled = false
    const errorBoundary = new ErrorBoundary({
      onReset: () => {
        resetCalled = true
      }
    })
    errorBoundary.state = { hasError: true, error: new Error('Test') }
    errorBoundary.setState = function(updater) {
      Object.assign(this.state, typeof updater === 'function' ? updater(this.state) : updater)
    }

    errorBoundary.handleReset()
    assert.strictEqual(errorBoundary.state.hasError, false)
    assert.strictEqual(errorBoundary.state.error, null)
    assert.strictEqual(resetCalled, true)
  })
})
