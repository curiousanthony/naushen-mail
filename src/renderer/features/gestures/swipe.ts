/**
 * Pure maths for the trackpad swipe on a thread row. No DOM, no React: unit-tested in
 * tests/renderer/gestures.test.ts.
 *
 * macOS delivers a two-finger swipe as a stream of `wheel` events (deltaX/deltaY) that keeps
 * going for ~0.5s after the fingers lift (inertia). There is no "touch end", so a gesture is
 * inferred from the stream itself:
 *   - a *burst* is a run of wheel events with gaps < BURST_GAP_MS;
 *   - the burst's first few events decide its axis. Only a horizontal-dominant burst may become
 *     a swipe, so a vertical scroll that drifts sideways never hijacks anything;
 *   - the fingers are considered lifted once events stop for RELEASE_MS, or (once past the
 *     threshold) when the deltas clearly decay, which is the inertia tail starting.
 */

/** Finger travel (px) at which releasing commits the action. */
export const SWIPE_THRESHOLD = 88
/** Silence (ms) after which a swipe counts as released. */
export const RELEASE_MS = 90
/** Gap (ms) that separates one wheel burst from the next. */
export const BURST_GAP_MS = 140

/**
 * Finger travel -> row travel. 1:1 up to the threshold, then friction so the row "stretches"
 * and never runs away from the finger. Symmetric in sign.
 */
export function rubber(raw: number, threshold = SWIPE_THRESHOLD): number {
  const a = Math.abs(raw)
  if (a <= threshold) return raw
  const room = threshold * 0.85
  const extra = room * (1 - Math.exp(-(a - threshold) / room))
  return Math.sign(raw) * (threshold + extra)
}

export type Axis = 'x' | 'y'

/**
 * Classifies a wheel burst. Feed every wheel event; the answer is `pending` for the first
 * couple of (often tiny, noisy) events, then sticks to 'x' or 'y' until the burst ends.
 */
export class WheelBurst {
  axis: Axis | 'pending' = 'pending'
  /** Sum of deltaX over the burst so far (raw finger travel, sign as delivered). */
  sumX = 0
  private sumY = 0
  private n = 0
  private last = -Infinity
  /** Set once a swipe finished: the rest of the burst (inertia) is ignored. */
  spent = false

  feed(dx: number, dy: number, t: number): Axis | 'pending' | 'spent' {
    if (t - this.last > BURST_GAP_MS) {
      this.axis = 'pending'; this.sumX = 0; this.sumY = 0; this.n = 0; this.spent = false
    }
    this.last = t
    if (this.spent) return 'spent'
    this.n++
    this.sumX += dx
    this.sumY += dy
    if (this.axis === 'pending' && (this.n >= 3 || Math.abs(this.sumX) + Math.abs(this.sumY) >= 6)) {
      const ax = Math.abs(this.sumX), ay = Math.abs(this.sumY)
      // Horizontal must clearly dominate; anything ambiguous is left to vertical scrolling.
      this.axis = ax >= 3 && ax > ay * 2 ? 'x' : 'y'
    }
    return this.axis
  }

  /** Mark the burst as consumed (swipe committed or cancelled); later events are inertia. */
  finish(): void { this.spent = true }
  reset(): void { this.axis = 'pending'; this.sumX = 0; this.sumY = 0; this.n = 0; this.spent = false; this.last = -Infinity }
}

/** The direction the fingers (and the row) moved. */
export type SwipeSide = 'left' | 'right'

export interface SwipeView {
  /** Row translation in px (rubber-banded). Positive = row moves right. */
  offset: number
  /** Direction swiped, or null before any movement. */
  side: SwipeSide | null
  /** Past the threshold: releasing now commits. */
  armed: boolean
  /** 0..1 progress towards the threshold, for the icon reveal. */
  progress: number
}

/**
 * Tracks one swipe. `raw` follows the fingers (natural scrolling: fingers moving right make
 * `deltaX` negative, so `raw += -deltaX`).
 */
export class SwipeTracker {
  raw = 0
  private prevMag = 0
  private decay = 0
  private peak = 0
  constructor(private threshold = SWIPE_THRESHOLD) {}

  /** Apply a wheel delta. Returns true when the deceleration tail after an armed swipe is seen. */
  push(dx: number): boolean {
    this.raw += -dx
    const mag = Math.abs(dx)
    this.peak = Math.max(this.peak, mag)
    if (mag < this.prevMag) this.decay++
    else this.decay = 0
    this.prevMag = mag
    // Three consecutive shrinking deltas well below the peak while armed: the fingers are up
    // and this is inertia. Commit now instead of waiting the inertia out.
    return this.view().armed && this.decay >= 3 && mag < this.peak * 0.6
  }

  view(): SwipeView {
    const offset = rubber(this.raw, this.threshold)
    const a = Math.abs(this.raw)
    return {
      offset,
      side: this.raw === 0 ? null : this.raw > 0 ? 'right' : 'left',
      armed: a >= this.threshold,
      progress: Math.min(1, a / this.threshold)
    }
  }

  /** Side to commit on release, or null when released short of the threshold. */
  release(): SwipeSide | null {
    const v = this.view()
    return v.armed ? v.side : null
  }
}
