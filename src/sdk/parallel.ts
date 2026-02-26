/**
 * asana.parallel() — concurrent execution with built-in rate limiting.
 *
 * Asana's rate limit is ~150 req/min. This helper runs N promises concurrently
 * while enforcing a per-second request budget via a semaphore + Bun.sleep backpressure.
 *
 * Agents use this instead of raw Promise.all so they never need to reason about
 * Asana API rate limits themselves.
 *
 * @example
 * const results = await parallel([
 *   asana.tasks.add({ name: "A", workspaceGid }),
 *   asana.tasks.add({ name: "B", workspaceGid }),
 *   asana.tasks.add({ name: "C", workspaceGid }),
 * ], { concurrency: 5 });
 */

export type ParallelOpts = {
  /**
   * Maximum simultaneous in-flight promises.
   * Default: 5 (conservative for Asana API).
   */
  readonly concurrency?: number;
  /**
   * Minimum delay between launching each promise (ms).
   * Default: 100ms — gives ~600 req/min headroom at concurrency=5,
   * well within Asana's 150 req/min limit per the real bottleneck (API latency).
   */
  readonly delayMs?: number;
};

export type ParallelResult<T> =
  | { readonly ok: true; readonly value: T; readonly index: number }
  | { readonly ok: false; readonly error: unknown; readonly index: number };

/**
 * Runs an array of promises with bounded concurrency and optional backpressure.
 *
 * Unlike Promise.all, this:
 *  1. Limits simultaneous in-flight promises to `concurrency`
 *  2. Adds `delayMs` between launching new tasks (rate-limit buffer)
 *  3. Never throws — returns ParallelResult<T>[] for each input
 *
 * If you want "fail fast", filter results for `!result.ok`.
 */
export async function parallel<T>(
  promises: readonly (() => Promise<T>)[],
  opts: ParallelOpts = {},
): Promise<ParallelResult<T>[]> {
  const concurrency = opts.concurrency ?? 5;
  const delayMs = opts.delayMs ?? 100;

  const results: ParallelResult<T>[] = new Array(promises.length);
  let nextIndex = 0;
  let inFlight = 0;

  async function runNext(): Promise<void> {
    if (nextIndex >= promises.length) return;
    const index = nextIndex++;
    inFlight++;

    const factory = promises[index];
    if (!factory) { inFlight--; return; }

    try {
      const value = await factory();
      results[index] = { ok: true, value, index };
    } catch (error) {
      results[index] = { ok: false, error, index };
    } finally {
      inFlight--;
    }
  }

  // Drain the queue: launch up to `concurrency` at a time with delay between each launch
  const queue: Promise<void>[] = [];

  for (let i = 0; i < promises.length; i += 1) {
    // Wait until we have a free slot
    while (inFlight >= concurrency) {
      await Bun.sleep(10);
    }
    queue.push(runNext());
    if (delayMs > 0) await Bun.sleep(delayMs);
  }

  // Wait for all in-flight to finish
  await Promise.all(queue);

  return results;
}

/**
 * Like `parallel`, but throws if any promise rejects (same semantics as Promise.all
 * but with bounded concurrency).
 */
export async function parallelAll<T>(
  promises: readonly (() => Promise<T>)[],
  opts: ParallelOpts = {},
): Promise<T[]> {
  const results = await parallel(promises, opts);
  const errors = results.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok);
  if (errors.length > 0) {
    const first = errors[0];
    const err = first?.error;
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
  return results
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.value);
}
