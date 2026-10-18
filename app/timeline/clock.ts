// Follows the `now` prop between renders so the window can slide every frame
// while React only re-renders at coarse ticks. The shell may pass a clock
// corrected for server skew, or (in demos) one running faster than real time;
// the follower learns the rate from successive values and extrapolates.
//
// It holds still until it has seen the clock move, as upstream draws exactly
// at its `now`: a frozen clock stays frozen, and the first change it sees sets
// the rate outright.

export class ClockFollower {
  private base: number;
  private at: number;
  private speed = 0;
  private seen = false;

  constructor(
    now: number,
    private readonly perfNow: () => number = () => performance.now(),
  ) {
    this.base = now;
    this.at = this.perfNow();
  }

  /** Feed the latest `now` prop. Repeated values are ignored. */
  sync(now: number): void {
    if (now === this.base) return;
    const at = this.perfNow();
    const elapsed = at - this.at;
    const observed = elapsed > 0 ? (now - this.base) / elapsed : 0;
    if (!this.seen) {
      this.seen = true;
      this.speed = snap(observed > 0 && observed < 10_000 ? observed : 1);
    } else if (elapsed >= 150 && observed > 0 && observed < 10_000) {
      this.speed = snap(this.speed * 0.6 + observed * 0.4);
    }
    this.base = now;
    this.at = at;
  }

  /** Clock ms per real ms: 1 for a real clock, higher for an accelerated demo, 0 until it moves. */
  get rate(): number {
    return this.speed;
  }

  read(): number {
    return this.base + (this.perfNow() - this.at) * this.speed;
  }
}

/** Real time when close, so ordinary jitter never warps the clock. */
function snap(speed: number): number {
  return Math.abs(speed - 1) < 0.15 ? 1 : speed;
}
