import { describe, it, expect } from "bun:test";
import { parallel, parallelAll } from "../parallel.ts";

describe("parallel", () => {
  it("executes all factories and returns results in order", async () => {
    const results = await parallel(
      [
        () => Promise.resolve("a"),
        () => Promise.resolve("b"),
        () => Promise.resolve("c"),
      ],
      { delayMs: 0 },
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ ok: true, value: "a", index: 0 });
    expect(results[1]).toMatchObject({ ok: true, value: "b", index: 1 });
    expect(results[2]).toMatchObject({ ok: true, value: "c", index: 2 });
  });

  it("captures errors without throwing", async () => {
    const results = await parallel(
      [
        () => Promise.resolve("ok"),
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve("also ok"),
      ],
      { delayMs: 0 },
    );
    expect(results[0]).toMatchObject({ ok: true, value: "ok" });
    expect(results[1]).toMatchObject({ ok: false });
    expect(results[2]).toMatchObject({ ok: true, value: "also ok" });
  });

  it("respects concurrency limit (does not exceed in-flight count)", async () => {
    let maxInFlight = 0;
    let inFlight = 0;

    const factories = Array.from({ length: 10 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(10);
      inFlight--;
      return i;
    });

    await parallel(factories, { concurrency: 3, delayMs: 0 });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("handles empty array", async () => {
    const results = await parallel([], { delayMs: 0 });
    expect(results).toHaveLength(0);
  });
});

describe("parallelAll", () => {
  it("returns values when all succeed", async () => {
    const values = await parallelAll(
      [() => Promise.resolve(1), () => Promise.resolve(2)],
      { delayMs: 0 },
    );
    expect(values).toEqual([1, 2]);
  });

  it("throws if any factory rejects", async () => {
    await expect(
      parallelAll(
        [() => Promise.resolve(1), () => Promise.reject(new Error("fail"))],
        { delayMs: 0 },
      ),
    ).rejects.toThrow("fail");
  });
});
