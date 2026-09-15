/**
 * Real-time Temporal Corner Stabilizer (Adaptive EMA Filter)
 *
 * Provides smooth 60 FPS corner coordinate tracking for camera preview overlays.
 * Dynamically adjusts Exponential Moving Average (EMA) smoothing weight (alpha):
 * - Static hold: low alpha (~0.20) for rock-solid jitter suppression.
 * - Dynamic motion: high alpha (~0.85) for responsive real-time tracking with zero lag.
 * - Scene transition: immediate snap (alpha = 1.0) when coordinates teleport.
 */

export class CornerStabilizer {
  /**
   * @param {object} [options]
   * @param {number} [options.minAlpha=0.20] - Alpha for stationary / low jitter frames
   * @param {number} [options.maxAlpha=0.85] - Alpha for high motion frames
   * @param {number} [options.lowDelta=4] - Lower displacement threshold (px)
   * @param {number} [options.highDelta=35] - Upper displacement threshold (px)
   * @param {number} [options.snapDelta=120] - Teleport threshold for immediate snap (px)
   */
  constructor(options = {}) {
    this.minAlpha = options.minAlpha ?? 0.20
    this.maxAlpha = options.maxAlpha ?? 0.85
    this.lowDelta = options.lowDelta ?? 4
    this.highDelta = options.highDelta ?? 35
    this.snapDelta = options.snapDelta ?? 120
    this.smoothedCorners = null
  }

  /**
   * Resets internal tracking state.
   */
  reset() {
    this.smoothedCorners = null
  }

  /**
   * Gets the last smoothed corner coordinates or null.
   * @returns {Array<{x: number, y: number}> | null}
   */
  getLastCorners() {
    if (!this.smoothedCorners) return null
    return this.smoothedCorners.map(p => ({ x: p.x, y: p.y }))
  }

  /**
   * Feeds new raw corner points into the adaptive EMA filter.
   *
   * @param {Array<{x: number, y: number}>} corners - 4 raw corner coordinates
   * @returns {Array<{x: number, y: number}> | null} Smoothed 4 corner coordinates
   */
  update(corners) {
    if (!corners || corners.length !== 4) {
      return null
    }

    // Initialize state on first valid frame
    if (!this.smoothedCorners) {
      this.smoothedCorners = corners.map(p => ({ x: p.x, y: p.y }))
      return this.smoothedCorners.map(p => ({ x: p.x, y: p.y }))
    }

    // Calculate total displacement across all 4 corners
    let totalDelta = 0
    for (let i = 0; i < 4; i++) {
      const dx = corners[i].x - this.smoothedCorners[i].x
      const dy = corners[i].y - this.smoothedCorners[i].y
      totalDelta += Math.hypot(dx, dy)
    }

    // Teleport threshold: snap immediately without sluggish interpolation
    if (totalDelta > this.snapDelta) {
      this.smoothedCorners = corners.map(p => ({ x: p.x, y: p.y }))
      return this.smoothedCorners.map(p => ({ x: p.x, y: p.y }))
    }

    // Adaptive alpha calculation
    let alpha
    if (totalDelta <= this.lowDelta) {
      alpha = this.minAlpha
    } else if (totalDelta >= this.highDelta) {
      alpha = this.maxAlpha
    } else {
      const t = (totalDelta - this.lowDelta) / (this.highDelta - this.lowDelta)
      alpha = this.minAlpha + t * (this.maxAlpha - this.minAlpha)
    }

    // Apply EMA update
    for (let i = 0; i < 4; i++) {
      this.smoothedCorners[i].x += alpha * (corners[i].x - this.smoothedCorners[i].x)
      this.smoothedCorners[i].y += alpha * (corners[i].y - this.smoothedCorners[i].y)
    }

    return this.smoothedCorners.map(p => ({ x: p.x, y: p.y }))
  }
}
