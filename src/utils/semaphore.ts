/**
 * Limits how many tasks run at the same time. A finished task hands its slot
 * straight to the next waiting task, so the limit holds even when a new task
 * arrives in the same tick.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  /**
   * The number of tasks that wait for a free slot
   */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * True when a new task would have to wait for a free slot
   */
  get isFull(): boolean {
    return this.active >= this.limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    }
  }
}
