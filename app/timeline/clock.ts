// Follows the `now` prop between renders so the window can slide every frame
// while React only re-renders at coarse ticks. The shell may pass a clock
// corrected for server skew, or (in demos) one running faster than real time;
// the follower learns the rate from successive values and extrapolates.

export class ClockFollower {
  private base: number;
  private at: number;
  private speed = 1;

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
    if (elapsed >= 150) {
      const observed = (now - this.base) / elapsed;
      if (observed > 0 && observed < 10_000) {
        // Snap to real time when close, so ordinary jitter never warps the clock.
        const next = this.speed * 0.6 + observed * 0.4;
        this.speed = Math.abs(next - 1) < 0.15 ? 1 : next;
      }
    }
    this.base = now;
    this.at = at;
  }

  /** Clock ms per real ms: 1 for a real clock, higher for an accelerated demo. */
  get rate(): number {
    return this.speed;
  }

  read(): number {
    return this.base + (this.perfNow() - this.at) * this.speed;
  }
}
