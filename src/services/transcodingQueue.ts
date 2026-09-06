import { logger } from '../utils/logger.js';

type JobFn = () => Promise<void>;

interface QueueEntry {
  id: string;
  job: JobFn;
}

/**
 * Concurrency-limited transcoding queue.
 *
 * Only MAX_CONCURRENT_TRANSCODES jobs run simultaneously (default: 1).
 * Duplicate job IDs are silently rejected.
 */
export class TranscodingQueue {
  private queue: QueueEntry[] = [];
  private activeIds = new Set<string>();
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Adds a job to the queue.
   * Returns false if the ID is already queued or active.
   */
  enqueue(id: string, job: JobFn): boolean {
    if (this.activeIds.has(id) || this.queue.some((e) => e.id === id)) {
      logger.warn(`Transcoding queue: duplicate job rejected for ${id}`);
      return false;
    }

    this.queue.push({ id, job });
    logger.info(`Transcoding queue: enqueued ${id} (queue length: ${this.queue.length})`);
    this.processNext();
    return true;
  }

  isActive(id: string): boolean {
    return this.activeIds.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.some((e) => e.id === id);
  }

  isPending(id: string): boolean {
    return this.isActive(id) || this.isQueued(id);
  }

  get activeCount(): number {
    return this.activeIds.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  private processNext(): void {
    if (this.activeIds.size >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const entry = this.queue.shift()!;
    this.activeIds.add(entry.id);

    logger.info(`Transcoding queue: starting ${entry.id} (active: ${this.activeIds.size})`);

    entry.job()
      .then(() => {
        logger.info(`Transcoding queue: completed ${entry.id}`);
      })
      .catch((err: unknown) => {
        logger.error(`Transcoding queue: job failed for ${entry.id}`, err);
      })
      .finally(() => {
        this.activeIds.delete(entry.id);
        this.processNext();
      });
  }

  /** Stop accepting new jobs (does not cancel running jobs). */
  drain(): void {
    this.queue.length = 0;
    logger.info('Transcoding queue drained (no new jobs will start)');
  }
}
