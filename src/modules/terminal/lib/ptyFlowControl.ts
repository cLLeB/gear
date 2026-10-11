// Output flow control for one pty. xterm.js parses writes asynchronously, so a
// fast producer (`cat` of a huge file) can queue output far faster than it is
// parsed. Past the high-water mark the pty is paused in the backend, which
// stops reading and lets the kernel pipe block the producer; it resumes once
// the backlog falls under the low-water mark.

export const FLOW_HIGH_WATER = 1024 * 1024;
export const FLOW_LOW_WATER = 256 * 1024;

export class PtyFlowControl {
  private pending = 0;
  private paused = false;
  private epoch = 0;

  constructor(
    private readonly setPaused: (paused: boolean) => void,
    private readonly high = FLOW_HIGH_WATER,
    private readonly low = FLOW_LOW_WATER,
  ) {}

  /** Account for a write; returns the callback to hand to `term.write`. */
  track(bytes: number): () => void {
    const epoch = this.epoch;
    this.pending += bytes;
    if (!this.paused && this.pending > this.high) {
      this.paused = true;
      this.setPaused(true);
    }
    return () => {
      // A reset dropped this write's terminal; its late callback is stale.
      if (epoch !== this.epoch) return;
      this.pending -= bytes;
      if (this.paused && this.pending < this.low) {
        this.paused = false;
        this.setPaused(false);
      }
    };
  }

  /** Forget the backlog, e.g. when the terminal it was queued on is gone. */
  reset(): void {
    this.epoch += 1;
    this.pending = 0;
    if (this.paused) {
      this.paused = false;
      this.setPaused(false);
    }
  }
}
